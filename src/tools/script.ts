/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';
import type {
  Frame,
  JSHandle,
  Page,
  Realm,
  WebWorker,
} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import type {Response} from './ToolDefinition.js';
import {defineTool, pageIdSchema} from './ToolDefinition.js';

export type Evaluatable = Page | Frame | WebWorker;
type EvaluationTarget = Evaluatable | Realm;

export const evaluateScript = defineTool(() => {
  return {
    name: 'evaluate_script',
    description: `Evaluate a JavaScript function inside the currently selected page. Returns the response as JSON,
so returned values have to be JSON-serializable.`,
    annotations: {
      category: ToolCategory.DEBUGGING,
      readOnlyHint: false,
    },
    schema: {
      function: zod.string().describe(
        `A JavaScript function declaration to be executed by the tool in the currently selected page.
Example without arguments: \`() => {
  return document.title
}\` or \`async () => {
  return await fetch("example.com")
}\`.
Example with arguments: \`(el) => {
  return el.innerText;
}\`
`,
      ),
      args: zod
        .array(
          zod
            .string()
            .describe(
              'The uid of an element on the page from the page content snapshot',
            ),
        )
        .optional()
        .describe(`An optional list of arguments to pass to the function.`),
      dialogAction: zod
        .string()
        .optional()
        .describe(
          'Handle dialogs while execution. "accept", "dismiss", or string for response of window.prompt. Defaults to accept.',
        ),
      world: zod
        .enum(['isolated', 'main'])
        .optional()
        .describe(
          'Execution world. "isolated" (default when no args/element UIDs are passed; recommended for stealth) runs in a fresh isolated context invisible to page scripts and to Function.prototype.toString patching detection. "main" runs in the same realm as page scripts. Defaults to "main" when args contain element UIDs, since element handles can only be evaluated in the realm that created them. Has no effect when evaluating in a service worker.',
        ),
      ...pageIdSchema,
    },
    blockedByDialog: true,
    handler: async (request, response, context) => {
      const {args: uidArgs, function: fnString, dialogAction} = request.params;
      // Element handles are bound to the realm that created them, so when the
      // caller passes element UIDs we have to evaluate in main world. Default
      // to isolated when no element UIDs are passed.
      const world =
        request.params.world ??
        (uidArgs && uidArgs.length > 0 ? 'main' : 'isolated');

      const mcpPage = request.params.pageId
        ? context.getPageById(request.params.pageId)
        : context.getSelectedMcpPage();
      const page: Page = mcpPage.pptrPage;

      const args: Array<JSHandle<unknown>> = [];
      try {
        const frames = new Set<Frame>();
        for (const uid of uidArgs ?? []) {
          const handle = await mcpPage.getElementByUid(uid);
          frames.add(handle.frame);
          args.push(handle);
        }

        const evaluatable = await getPageOrFrame(page, frames);
        const target: EvaluationTarget =
          world === 'isolated' ? toIsolatedRealm(evaluatable) : evaluatable;

        await mcpPage.waitForEventsAfterAction(
          async () => {
            await performEvaluation(target, fnString, args, response);
          },
          {handleDialog: dialogAction ?? 'accept'},
        );
      } finally {
        void Promise.allSettled(args.map(arg => arg.dispose()));
      }
    },
  };
});

// Frame.isolatedRealm() is marked @internal in puppeteer-core's public types
// but is the supported way to get a Realm scoped to an isolated world. We cast
// through a structural type so the @internal tag does not block compilation.
type IsolatedRealmFrame = Frame & {isolatedRealm: () => Realm};

const toIsolatedRealm = (target: Page | Frame): Realm => {
  const frame = 'mainFrame' in target ? target.mainFrame() : target;
  return (frame as IsolatedRealmFrame).isolatedRealm();
};

const performEvaluation = async (
  target: EvaluationTarget,
  fnString: string,
  args: Array<JSHandle<unknown>>,
  response: Response,
) => {
  const fn = await target.evaluateHandle(`(${fnString})`);
  try {
    const result = await target.evaluate(
      async (fn, ...args) => {
        // @ts-expect-error no types for function fn
        return JSON.stringify(await fn(...args));
      },
      fn,
      ...args,
    );
    response.appendResponseLine('Script ran on page and returned:');
    response.appendResponseLine('```json');
    response.appendResponseLine(`${result}`);
    response.appendResponseLine('```');
  } finally {
    void fn.dispose();
  }
};

const getPageOrFrame = async (
  page: Page,
  frames: Set<Frame>,
): Promise<Page | Frame> => {
  let pageOrFrame: Page | Frame;
  // We can't evaluate the element handle across frames
  if (frames.size > 1) {
    throw new Error(
      "Elements from different frames can't be evaluated together.",
    );
  } else {
    pageOrFrame = [...frames.values()][0] ?? page;
  }

  return pageOrFrame;
};

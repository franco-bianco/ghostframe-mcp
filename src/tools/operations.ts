/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {parseRuntimeArguments} from '../investigation/RuntimeInspector.js';
import {CdpFrame, zod} from '../third_party/index.js';
import {
  humanizedClick,
  humanizedFill,
  humanizedKeyPress,
  humanizedType,
} from '../utils/humanInput.js';
import {parseKey} from '../utils/keyboard.js';

import {ToolCategory} from './categories.js';
import {definePageTool, defineTool} from './ToolDefinition.js';

export const startAction = definePageTool({
  name: 'start_action',
  description:
    'Start an action and return an operation ID immediately. Use this before a breakpoint or request interception. Read progress with get_operation.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {
    action: zod
      .enum([
        'navigate',
        'click',
        'fill',
        'type_text',
        'press_key',
        'evaluate',
        'call_handle',
      ])
      .describe('Browser action to start.'),
    url: zod.string().optional().describe('URL for a navigate action.'),
    uid: zod
      .string()
      .optional()
      .describe('Snapshot element UID for a click action.'),
    value: zod
      .string()
      .optional()
      .describe('Replacement field value for a fill action.'),
    text: zod
      .string()
      .optional()
      .describe('Text to type into the focused input for a type_text action.'),
    key: zod
      .string()
      .optional()
      .describe(
        'Key or combination for a press_key action, for example Enter or Control+A.',
      ),
    function: zod
      .string()
      .optional()
      .describe(
        'JavaScript function for an evaluate action, for example () => fetch("/api").then(r => r.json()).',
      ),
    handle: zod
      .string()
      .optional()
      .describe('Retained function handle for a call_handle action.'),
    thisHandle: zod
      .string()
      .optional()
      .describe('Retained receiver for a call_handle action.'),
    args: zod
      .string()
      .optional()
      .describe(
        'JSON array of {value: JSON} or {handle: ID} arguments for evaluation or a handle call.',
      ),
    targetId: zod
      .string()
      .optional()
      .describe(
        'Explicit runtime target for evaluation. Get IDs from list_targets.',
      ),
    frameId: zod
      .string()
      .optional()
      .describe('Explicit frame for evaluation. Get IDs from list_targets.'),
    returnMode: zod
      .enum(['value', 'handle'])
      .optional()
      .describe(
        'Return a JSON value or retain a remote handle. Default: value.',
      ),
    world: zod
      .enum(['main', 'isolated'])
      .optional()
      .describe('Evaluation world. Default: main.'),
    timeout: zod
      .number()
      .int()
      .min(100)
      .max(120000)
      .optional()
      .describe(
        'Observation deadline in milliseconds. Default: 30000. Expiry does not stop JavaScript.',
      ),
  },
  blockedByDialog: true,
  handler: async ({params, page: mcpPage}, response, context) => {
    const page = mcpPage.pptrPage;
    const manager = context.getOperationManager();
    const pageId =
      'id' in mcpPage && typeof mcpPage.id === 'number'
        ? mcpPage.id
        : undefined;
    const location = {
      pageId: params.targetId ? undefined : pageId,
      targetId: params.targetId,
      frameId: params.frameId,
      handle: params.action === 'call_handle' ? params.handle : undefined,
    };
    if (
      !['evaluate', 'call_handle'].includes(params.action) &&
      (params.targetId || params.frameId || params.handle)
    ) {
      throw new Error(
        'Input and navigation actions target pageId. targetId/frameId/handle apply to runtime actions.',
      );
    }
    if (params.action === 'navigate' && !params.url) {
      throw new Error('A navigate action requires url.');
    }
    if (params.action === 'click' && !params.uid) {
      throw new Error('A click action requires uid.');
    }
    if (
      params.action === 'fill' &&
      (!params.uid || params.value === undefined)
    ) {
      throw new Error('A fill action requires uid and value.');
    }
    if (params.action === 'type_text' && params.text === undefined) {
      throw new Error('A type_text action requires text.');
    }
    if (params.action === 'press_key') {
      if (!params.key) {
        throw new Error('A press_key action requires key.');
      }
      parseKey(params.key);
    }
    if (params.action === 'evaluate' && !params.function) {
      throw new Error('An evaluate action requires function.');
    }
    if (params.action === 'call_handle' && !params.handle) {
      throw new Error('A call_handle action requires handle.');
    }
    const args = parseRuntimeArguments(params.args);
    const inspector = context.getRuntimeInspector();
    const target =
      params.action === 'evaluate' || params.action === 'call_handle'
        ? await inspector.operationTarget(location)
        : page.target();
    manager.assertAvailable(target);
    const handle = params.uid
      ? await mcpPage.getElementByUid(params.uid)
      : undefined;
    const frame = page.mainFrame();
    if (!(frame instanceof CdpFrame)) {
      throw new Error('Background actions require a CDP page.');
    }
    const client = frame.client;
    const capturePageId = target === page.target() ? pageId : undefined;
    const abort = new AbortController();
    const terminateHandle =
      params.action === 'call_handle' && params.handle
        ? inspector.prepareHandleTermination(params.handle)
        : undefined;
    const inputOptions = {
      disabled: !context.getStealth(),
      signal: abort.signal,
    };
    const operation = manager.start(
      target,
      params.action,
      async () => {
        const capture = context.getNetworkCapture();
        const actionId = capture.markAction({
          tool: `start_action:${params.action}`,
          phase: 'start',
          pageId: capturePageId,
        });
        try {
          if (params.action === 'navigate' && params.url) {
            const result = await page.goto(params.url, {
              timeout: params.timeout ?? 30000,
            });
            return {url: page.url(), status: result?.status()};
          }
          if (params.action === 'click' && handle) {
            await humanizedClick(page, {type: 'handle', handle}, inputOptions);
            return {clicked: params.uid};
          }
          if (
            params.action === 'fill' &&
            handle &&
            params.value !== undefined
          ) {
            await humanizedFill(page, handle, params.value, inputOptions);
            return {filled: params.uid};
          }
          if (params.action === 'type_text' && params.text !== undefined) {
            await humanizedType(page, params.text, inputOptions);
            return {typed: true};
          }
          if (params.action === 'press_key' && params.key) {
            abort.signal.throwIfAborted();
            await humanizedKeyPress(page, params.key, inputOptions);
            return {pressed: params.key};
          }
          if (params.action === 'call_handle' && params.handle) {
            return await context.getRuntimeInspector().callHandle({
              handle: params.handle,
              thisHandle: params.thisHandle,
              args,
              returnMode: params.returnMode,
            });
          }
          if (params.function) {
            return await context.getRuntimeInspector().evaluate({
              function: params.function,
              pageId: params.targetId ? undefined : pageId,
              targetId: params.targetId,
              frameId: params.frameId,
              args,
              world: params.world ?? 'main',
              returnMode: params.returnMode ?? 'value',
            });
          }
          throw new Error('Invalid action parameters.');
        } finally {
          await handle?.dispose();
          capture.markAction({
            tool: `start_action:${params.action}`,
            phase: 'end',
            actionId,
            pageId: capturePageId,
          });
        }
      },
      async () => {
        abort.abort();
        if (params.action === 'navigate') {
          await client.send('Page.stopLoading');
        } else if (terminateHandle) {
          await terminateHandle();
        } else {
          await inspector.terminate(location);
        }
      },
      params.timeout,
    );
    response.appendResponseLine(JSON.stringify(operation));
  },
});

export const getOperation = defineTool({
  name: 'get_operation',
  description:
    'Read the state and result of an action. This call does not wait for completion.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
  schema: {
    operationId: zod.string().describe('Operation ID from start_action.'),
  },
  blockedByDialog: false,
  handler: async ({params}, response, context) => {
    response.appendResponseLine(
      JSON.stringify(context.getOperationManager().get(params.operationId)),
    );
  },
});

export const cancelOperation = defineTool({
  name: 'cancel_operation',
  description:
    'Stop loading for a navigation, or terminate JavaScript execution on the action page. JavaScript termination can also stop unrelated scripts in that page.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {operationId: zod.string().describe('Operation ID to cancel.')},
  blockedByDialog: false,
  handler: async ({params}, response, context) => {
    response.appendResponseLine(
      JSON.stringify(
        await context.getOperationManager().cancel(params.operationId),
      ),
    );
  },
});

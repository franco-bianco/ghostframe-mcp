/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  parseCookieData,
  parseRuntimeArguments,
} from '../investigation/RuntimeInspector.js';
import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {definePageTool, defineTool, pageIdSchema} from './ToolDefinition.js';

const locationSchema = {
  ...pageIdSchema,
  targetId: zod
    .string()
    .optional()
    .describe('Target ID from list_targets. Specify targetId or pageId.'),
  frameId: zod
    .string()
    .optional()
    .describe('Frame ID from list_targets; defaults to the main frame.'),
  world: zod
    .enum(['isolated', 'main'])
    .optional()
    .describe('Isolated by default for pages; workers have only main world.'),
};

export const listTargets = defineTool({
  name: 'list_targets',
  description:
    'List live page/worker targets and frame IDs for explicit runtime investigation. Does not enable the debugger or global auto-attachment.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
  schema: {},
  blockedByDialog: false,
  handler: async (_request, response, context) => {
    response.appendResponseLine(
      JSON.stringify(await context.getRuntimeInspector().listTargets()),
    );
  },
});

export const runtimeEvaluate = defineTool({
  name: 'runtime_evaluate',
  description:
    'Execute a JavaScript function in an explicit page frame or worker. Return a value or retain a remote handle for non-JSON objects and functions. Handles expire on navigation/target destruction. For actions that may pause on a breakpoint, use start_action.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {
    ...locationSchema,
    function: zod
      .string()
      .describe('JavaScript function declaration to invoke.'),
    args: zod
      .string()
      .optional()
      .describe(
        'JSON array of {value: JSON} or {handle: ID}; handles must share the target/frame/world.',
      ),
    returnMode: zod.enum(['value', 'handle']).optional(),
  },
  blockedByDialog: true,
  handler: async (request, response, context) => {
    const inspector = context.getRuntimeInspector();
    const target = await inspector.operationTarget(request.params);
    context.getOperationManager().assertAvailable(target);
    const page = target.type() === 'page' ? await target.page() : null;
    if (
      inspector.hasDebuggerAt(request.params) ||
      (page && context.getInterceptionController().isActive(page))
    ) {
      throw new Error(
        'Debugger or interception is active; use start_action to evaluate without holding the foreground tool mutex.',
      );
    }
    response.appendResponseLine(
      JSON.stringify(
        await inspector.evaluate({
          ...request.params,
          args: parseRuntimeArguments(request.params.args),
        }),
      ),
    );
  },
});

export const inspectHandle = defineTool({
  name: 'inspect_handle',
  description:
    'Inspect remote properties, getter/setter handles and available engine internal/private properties including function scopes. Does not invoke getters. Engine visibility is version-dependent; optimized variables may be unavailable.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
  schema: {
    handle: zod.string(),
    ownProperties: zod
      .boolean()
      .optional()
      .describe('Default true; false includes inherited properties.'),
  },
  blockedByDialog: false,
  handler: async (request, response, context) => {
    response.appendResponseLine(
      JSON.stringify(
        await context
          .getRuntimeInspector()
          .inspectHandle(request.params.handle, request.params.ownProperties),
      ),
    );
  },
});

export const callHandle = defineTool({
  name: 'call_handle',
  description:
    'Invoke an actual retained function with its original closure. Optional thisHandle sets the receiver. Execution may change page state; a source string does not replace the retained closure.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {
    handle: zod.string(),
    thisHandle: zod.string().optional(),
    args: zod
      .string()
      .optional()
      .describe('JSON array of {value: JSON} or {handle: ID} arguments.'),
    returnMode: zod.enum(['value', 'handle']).optional(),
  },
  blockedByDialog: true,
  handler: async (request, response, context) => {
    const inspector = context.getRuntimeInspector();
    const target = await inspector.operationTarget(request.params);
    context.getOperationManager().assertAvailable(target);
    const page = target.type() === 'page' ? await target.page() : null;
    if (
      inspector.handleHasDebugger(request.params.handle) ||
      (page && context.getInterceptionController().isActive(page))
    ) {
      throw new Error(
        'Debugger or interception is active; use start_action call_handle so pauses can be inspected and released.',
      );
    }
    response.appendResponseLine(
      JSON.stringify(
        await inspector.callHandle({
          ...request.params,
          args: parseRuntimeArguments(request.params.args),
        }),
      ),
    );
  },
});

export const releaseHandles = defineTool({
  name: 'release_handles',
  description:
    'Release retained remote handles. Omit handles to release all investigation handles.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {handles: zod.array(zod.string()).optional()},
  blockedByDialog: false,
  handler: async (request, response, context) => {
    response.appendResponseLine(
      JSON.stringify(
        await context
          .getRuntimeInspector()
          .releaseHandles(request.params.handles),
      ),
    );
  },
});

export const getEventListeners = definePageTool({
  name: 'get_event_listeners',
  description:
    'Inspect currently registered listeners on a snapshot element and, optionally, its ancestors/document/window. Returns function handles and source coordinates without enabling Debugger. Framework delegation may expose a dispatcher rather than the application callback.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
  schema: {
    uid: zod.string().describe('Element UID from a current snapshot.'),
    includeAncestors: zod
      .boolean()
      .optional()
      .describe('Default true, to include delegated handlers.'),
  },
  blockedByDialog: false,
  handler: async (request, response, context) => {
    const element = await request.page.getElementByUid(request.params.uid);
    try {
      response.appendResponseLine(
        JSON.stringify(
          await context
            .getRuntimeInspector()
            .eventListeners(
              request.page.pptrPage,
              element,
              request.params.includeAncestors,
            ),
        ),
      );
    } finally {
      await element.dispose();
    }
  },
});

export const sessionCookies = defineTool({
  name: 'session_cookies',
  description:
    'Read, set or remove cookies in a page browser context, including HttpOnly cookies. Cookie mutations require explicit set/remove action and exact cookie scope.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {
    ...pageIdSchema,
    action: zod.enum(['list', 'set', 'remove']),
    cookies: zod
      .string()
      .optional()
      .describe(
        'JSON array of cookies: name/domain, value for set, optional path/secure/httpOnly/expires/sameSite/partitionKey. Remove matches exact name/domain/path/partition.',
      ),
  },
  blockedByDialog: false,
  handler: async (request, response, context) => {
    response.appendResponseLine(
      JSON.stringify(
        await context.getRuntimeInspector().cookies({
          ...request.params,
          cookies: parseCookieData(
            request.params.cookies,
            request.params.action === 'set',
          ),
        }),
      ),
    );
  },
});

export const inspectStorage = defineTool({
  name: 'inspect_storage',
  description:
    'Inspect local/session storage, IndexedDB database/store entries, or CacheStorage in an explicit frame storage key. Defaults to the frame storage key so partitioned storage is addressed correctly. IndexedDB object values can be retained handles.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: true},
  schema: {
    ...locationSchema,
    kind: zod.enum(['local', 'session', 'indexeddb', 'cache']),
    storageKey: zod.string().optional(),
    databaseName: zod.string().optional(),
    objectStoreName: zod.string().optional(),
    cacheId: zod.string().optional(),
    requestURL: zod.string().optional(),
    skipCount: zod.number().int().min(0).optional(),
    pageSize: zod.number().int().min(1).max(1000).optional(),
  },
  blockedByDialog: false,
  handler: async (request, response, context) => {
    response.appendResponseLine(
      JSON.stringify(
        await context.getRuntimeInspector().storage(request.params),
      ),
    );
  },
});

export const debuggerControl = defineTool({
  name: 'debugger_control',
  description:
    'Manage an explicit bounded debugger investigation: start/status/stop/resume, source/function/XHR/event breakpoints, scripts/source, or paused-frame evaluation. Enabling Debugger changes runtime behavior and timing; it is not guaranteed stealth-safe. Session automatically resumes/stops at its deadline. Use start_action to trigger actions that can pause.',
  annotations: {category: ToolCategory.DEBUGGING, readOnlyHint: false},
  schema: {
    ...locationSchema,
    action: zod.enum([
      'start',
      'status',
      'stop',
      'resume',
      'breakpoint',
      'remove_breakpoint',
      'scripts',
      'source',
      'evaluate',
    ]),
    timeoutMs: zod
      .number()
      .int()
      .min(1000)
      .max(300000)
      .optional()
      .describe('Session deadline; default 60000, maximum 300000ms.'),
    kind: zod.enum(['source', 'function', 'xhr', 'event']).optional(),
    url: zod.string().optional(),
    lineNumber: zod.number().int().min(0).optional(),
    columnNumber: zod.number().int().min(0).optional(),
    condition: zod.string().optional(),
    handle: zod.string().optional(),
    eventName: zod.string().optional(),
    breakpointId: zod.string().optional(),
    scriptId: zod.string().optional(),
    callFrameId: zod.string().optional(),
    expression: zod.string().optional(),
    returnMode: zod.enum(['value', 'handle']).optional(),
  },
  blockedByDialog: false,
  handler: async (request, response, context) => {
    response.appendResponseLine(
      JSON.stringify(
        await context.getRuntimeInspector().debugger(request.params),
      ),
    );
  },
});

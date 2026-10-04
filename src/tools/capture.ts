/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

export const startCapture = defineTool({
  name: 'start_capture',
  description:
    'Start durable passive network capture. Saves metadata and eager bodies across navigations and page closure. Covers page primary sessions; independent workers and browser background traffic are excluded. Collected header values and body contents are saved unchanged. Optional fetch streaming uses experimental CDP support and reports gaps.',
  annotations: {category: ToolCategory.NETWORK, readOnlyHint: false},
  blockedByDialog: false,
  schema: {
    directory: zod
      .string()
      .optional()
      .describe(
        'Parent directory for a unique capture folder. Defaults to a temporary directory.',
      ),
    pageId: zod
      .number()
      .int()
      .optional()
      .describe(
        'Capture only this page. Omit to capture all pages and future tabs.',
      ),
    maxBodyBytes: zod
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Maximum size of each body/chunk. Default 5 MiB.'),
    maxTotalBytes: zod
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Capture byte budget. Default 100 MiB; terminal gap records can exceed it slightly.',
      ),
    streaming: zod
      .boolean()
      .optional()
      .describe(
        'Capture fetch/EventSource response chunks using experimental streamResourceContent. Default false. WebSocket and EventSource messages are always captured.',
      ),
  },
  handler: async (request, response, context) => {
    const params = request.params;
    const result = await context.getNetworkCapture().start({
      directory: params.directory,
      page:
        params.pageId === undefined
          ? undefined
          : context.getPageById(params.pageId).pptrPage,
      maxBodyBytes: params.maxBodyBytes,
      maxTotalBytes: params.maxTotalBytes,
      streaming: params.streaming,
    });
    response.appendResponseLine(JSON.stringify(result));
  },
});

export const stopCapture = defineTool({
  name: 'stop_capture',
  description:
    'Stop a network capture and flush pending bodies and its journal. Artifacts remain readable after stopping.',
  annotations: {category: ToolCategory.NETWORK, readOnlyHint: false},
  blockedByDialog: false,
  schema: {captureId: zod.string()},
  handler: async (request, response, context) => {
    response.appendResponseLine(
      JSON.stringify(
        await context.getNetworkCapture().stop(request.params.captureId),
      ),
    );
  },
});

export const readCapture = defineTool({
  name: 'read_capture',
  description:
    'Read capture journal records using a cursor. Bodies are immutable file references. Raw extra-info events preserve ordering and explicitly report unresolved redirect-hop associations. Filtering advances the cursor over scanned records.',
  annotations: {category: ToolCategory.NETWORK, readOnlyHint: true},
  blockedByDialog: false,
  schema: {
    captureId: zod.string(),
    cursor: zod.number().int().min(0).optional(),
    limit: zod.number().int().min(1).max(1000).optional(),
    url: zod.string().optional().describe('URL substring filter.'),
    method: zod.string().optional(),
    kind: zod
      .string()
      .optional()
      .describe(
        'Journal event kind, such as request, response, response_body, websocket_message or action.',
      ),
  },
  handler: async (request, response, context) => {
    const params = request.params;
    response.appendResponseLine(
      JSON.stringify(
        await context
          .getNetworkCapture()
          .read(params.captureId, params.cursor, params.limit, {
            url: params.url,
            method: params.method,
            kind: params.kind,
          }),
      ),
    );
  },
});

export const armNetworkWait = defineTool({
  name: 'arm_network_wait',
  description:
    'Arm a network observation before triggering an action. Returns immediately so it does not hold the browser tool queue. Then perform the action and inspect read_network_wait. Only future page traffic can match.',
  annotations: {category: ToolCategory.NETWORK, readOnlyHint: false},
  blockedByDialog: false,
  schema: {
    pageId: zod.number().int().optional(),
    url: zod.string().optional().describe('URL substring to match.'),
    method: zod.string().optional(),
    phase: zod.enum(['request', 'response', 'finished']).optional(),
    timeout: zod
      .number()
      .int()
      .min(1)
      .max(300000)
      .optional()
      .describe('Expiry in milliseconds. Default 30000.'),
  },
  handler: async (request, response, context) => {
    const params = request.params;
    response.appendResponseLine(
      JSON.stringify(
        await context.getNetworkCapture().armNetworkWait({
          page:
            params.pageId === undefined
              ? undefined
              : context.getPageById(params.pageId).pptrPage,
          url: params.url,
          method: params.method,
          phase: params.phase,
          timeout: params.timeout,
        }),
      ),
    );
  },
});

export const readNetworkWait = defineTool({
  name: 'read_network_wait',
  description:
    'Read the nonblocking network observation status: pending, matched, timed_out or cancelled. A matched observation includes the event metadata without header/body values.',
  annotations: {category: ToolCategory.NETWORK, readOnlyHint: true},
  blockedByDialog: false,
  schema: {observationId: zod.string()},
  handler: async (request, response, context) => {
    response.appendResponseLine(
      JSON.stringify(
        context
          .getNetworkCapture()
          .getNetworkWait(request.params.observationId),
      ),
    );
  },
});

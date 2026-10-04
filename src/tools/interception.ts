/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {definePageTool, defineTool} from './ToolDefinition.js';

export const armInterception = definePageTool({
  name: 'arm_interception',
  description:
    'Arm a one-shot request or response pause. Returns immediately. Trigger traffic with start_action, read_interception, then resolve_interception. The deadline continues unchanged traffic unless body consumption has begun: complete bodies are reconstructed, incomplete bodies abort.',
  annotations: {category: ToolCategory.NETWORK, readOnlyHint: false},
  schema: {
    urlPattern: zod
      .string()
      .min(1)
      .describe(
        'CDP URL wildcard pattern, for example */api/orders*. Use a narrow pattern.',
      ),
    stage: zod
      .enum(['request', 'response'])
      .optional()
      .describe(
        'Pause before sending a request, or before delivering its response. Default: request.',
      ),
    method: zod.string().optional().describe('Optional HTTP method filter.'),
    timeout: zod
      .number()
      .int()
      .min(100)
      .max(120000)
      .optional()
      .describe(
        'Deadline in milliseconds for triggering and resolving the pause. Default: 30000.',
      ),
  },
  blockedByDialog: false,
  handler: async ({params, page}, response, context) => {
    response.appendResponseLine(
      JSON.stringify(
        await context.getInterceptionController().arm(page.pptrPage, params),
      ),
    );
  },
});

export const readInterception = defineTool({
  name: 'read_interception',
  description:
    'Read the actual paused request or response. Header output reflects Fetch events; use capture extra-info for missing cookie headers. includeBody starts a bounded background stream read and returns immediately; poll again for completion. Consuming the body requires fulfillment or abort. Continue, cancel and expiry reconstruct a complete captured original; incomplete consumed bodies abort on cancel or expiry.',
  annotations: {category: ToolCategory.NETWORK, readOnlyHint: false},
  schema: {
    interceptionId: zod.string().describe('ID from arm_interception.'),
    includeBody: zod
      .boolean()
      .optional()
      .describe(
        'Start or poll a bounded response body stream read. A complete result contains base64 bytes. Default: false.',
      ),
    maxBodyBytes: zod
      .number()
      .int()
      .min(1)
      .max(1048576)
      .optional()
      .describe(
        'Maximum retained body bytes. Set on the first read; later polls preserve that limit. Default and maximum: 1048576.',
      ),
  },
  blockedByDialog: false,
  handler: async ({params}, response, context) => {
    const controller = context.getInterceptionController();
    response.appendResponseLine(
      JSON.stringify({
        ...controller.get(params.interceptionId),
        ...(params.includeBody
          ? {
              body: controller.body(params.interceptionId, params.maxBodyBytes),
            }
          : {}),
      }),
    );
  },
});

export const resolveInterception = defineTool({
  name: 'resolve_interception',
  description:
    'Continue or mutate a paused request, replace its actual response, abort it, or cancel the rule. This acts on browser traffic without replaying a new request.',
  annotations: {category: ToolCategory.NETWORK, readOnlyHint: false},
  schema: {
    interceptionId: zod.string().describe('ID from arm_interception.'),
    action: zod
      .enum(['continue', 'fulfill', 'abort', 'cancel'])
      .describe(
        'How to release the pause. cancel removes the rule and continues untouched traffic or reconstructs a complete consumed body; incomplete consumed bodies abort.',
      ),
    url: zod
      .string()
      .optional()
      .describe('Replacement request URL, for continue at request stage.'),
    method: zod
      .string()
      .optional()
      .describe('Replacement request method, for continue at request stage.'),
    postData: zod
      .string()
      .optional()
      .describe(
        'Replacement UTF-8 request body, for continue at request stage.',
      ),
    headers: zod
      .array(zod.string())
      .optional()
      .describe(
        'Complete replacement headers in Header-Name: value format. Duplicate names are supported.',
      ),
    status: zod
      .number()
      .int()
      .min(100)
      .max(599)
      .optional()
      .describe(
        'Replacement response status, for fulfill. Defaults to the original status or 200.',
      ),
    body: zod
      .string()
      .optional()
      .describe('Replacement response body, required for fulfill.'),
    bodyEncoding: zod
      .enum(['utf8', 'base64'])
      .optional()
      .describe('Encoding of replacement body. Default: utf8.'),
  },
  blockedByDialog: false,
  handler: async ({params}, response, context) => {
    const controller = context.getInterceptionController();
    const result =
      params.action === 'cancel'
        ? await controller.cancel(params.interceptionId)
        : await controller.resolve(params.interceptionId, {
            ...params,
            action: params.action,
          });
    response.appendResponseLine(JSON.stringify(result));
  },
});

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool} from './ToolDefinition.js';

export const getProxy = defineTool({
  name: 'get_proxy',
  description:
    'Get effective native Chrome proxy settings, scope and connection switching limitations. Proxy credentials are omitted.',
  annotations: {category: ToolCategory.NETWORK, readOnlyHint: true},
  schema: {},
  blockedByDialog: false,
  handler: async (_request, response, context) => {
    response.appendResponseLine(
      JSON.stringify(await context.getProxyController().get(), null, 2),
    );
  },
});

export const setProxy = defineTool({
  name: 'set_proxy',
  description:
    'Change the regular Chrome profile proxy after launch while preserving tabs and page state. Existing connections and streams may continue on their old route. Explicit context proxy overrides may differ. Changing previously configured credentials on the same host/port is unsupported because Chrome may cache authentication. Does not verify connectivity or route UDP/WebRTC traffic.',
  annotations: {category: ToolCategory.NETWORK, readOnlyHint: false},
  schema: {
    mode: zod
      .enum(['direct', 'proxy'])
      .describe('Choose direct access or a single upstream proxy.'),
    server: zod
      .string()
      .optional()
      .describe(
        'Proxy URL (http, https, socks4 or socks5), or host:port. Required in proxy mode. Supply credentials separately.',
      ),
    username: zod.string().optional().describe('HTTP/HTTPS proxy username.'),
    password: zod.string().optional().describe('HTTP/HTTPS proxy password.'),
    bypassList: zod
      .array(zod.string())
      .optional()
      .describe(
        'Chrome proxy bypass rules. Chrome also bypasses loopback/link-local hosts implicitly.',
      ),
    connectionPolicy: zod
      .enum(['new_connections', 'disconnect_existing'])
      .optional()
      .describe(
        'Only new_connections is supported. disconnect_existing fails without changing settings because native Chrome exposes no explicit socket close control here.',
      ),
  },
  blockedByDialog: false,
  handler: async (request, response, context) => {
    response.appendResponseLine(
      JSON.stringify(
        await context.getProxyController().set(request.params),
        null,
        2,
      ),
    );
  },
});

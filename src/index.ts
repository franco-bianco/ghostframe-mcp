/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type fs from 'node:fs';

import type {parseArguments} from './bin/ghostframe-mcp-cli-options.js';
import type {Channel} from './browser.js';
import {ensureBrowserLaunched} from './browser.js';
import {loadIssueDescriptions} from './issue-descriptions.js';
import {logger} from './logger.js';
import {McpContext} from './McpContext.js';
import {McpResponse} from './McpResponse.js';
import {Mutex} from './Mutex.js';
import type {Browser} from './third_party/index.js';
import {
  McpServer,
  type CallToolResult,
  SetLevelRequestSchema,
  ListRootsResultSchema,
  RootsListChangedNotificationSchema,
} from './third_party/index.js';
import type {ToolCategory} from './tools/categories.js';
import {labels, OFF_BY_DEFAULT_CATEGORIES} from './tools/categories.js';
import type {DefinedPageTool, ToolDefinition} from './tools/ToolDefinition.js';
import {pageIdSchema} from './tools/ToolDefinition.js';
import {createTools} from './tools/tools.js';
import {parseProxy} from './utils/proxy.js';
import {redactSensitiveValues} from './utils/redact.js';
import {VERSION} from './version.js';

export function buildFlag(category: ToolCategory) {
  return `category${category.charAt(0).toUpperCase() + category.slice(1)}`;
}

function buildDisabledMessage(
  toolName: string,
  flag: string,
  categoryLabel?: string,
): string {
  const reason = categoryLabel
    ? `is in category ${categoryLabel} which`
    : `requires experimental feature ${flag} and`;

  return `Tool ${toolName} ${reason} is currently disabled. Enable it by running ghostframe start ${flag}=true. For more information check the README.`;
}

function getCategoryStatus(
  category: ToolCategory,
  serverArgs: ReturnType<typeof parseArguments>,
): {categoryFlag?: string; disabled: boolean} {
  const categoryFlag = buildFlag(category);

  const flagValue = serverArgs[categoryFlag];

  const isDisabled = OFF_BY_DEFAULT_CATEGORIES.includes(category)
    ? !flagValue
    : flagValue === false;

  if (isDisabled) {
    return {
      categoryFlag,
      disabled: true,
    };
  }

  return {
    disabled: false,
  };
}

function getConditionStatus(
  condition: string,
  serverArgs: ReturnType<typeof parseArguments>,
): {conditionFlag?: string; disabled: boolean} {
  if (condition && !serverArgs[condition]) {
    return {conditionFlag: condition, disabled: true};
  }

  return {disabled: false};
}

function getToolStatusInfo(
  tool: ToolDefinition | DefinedPageTool,
  serverArgs: ReturnType<typeof parseArguments>,
): {disabled: boolean; reason?: string} {
  const category = tool.annotations.category;
  const categoryCheck = getCategoryStatus(category, serverArgs);

  if (category && categoryCheck.disabled) {
    if (!categoryCheck.categoryFlag) {
      throw new Error(
        'when the category is disabled there should always be a flag set',
      );
    }

    return {
      disabled: true,
      reason: buildDisabledMessage(
        tool.name,
        `--${categoryCheck.categoryFlag}`,
        labels[category!],
      ),
    };
  }

  for (const condition of tool.annotations.conditions || []) {
    const conditionCheck = getConditionStatus(condition, serverArgs);
    if (conditionCheck.disabled) {
      if (!conditionCheck.conditionFlag) {
        throw new Error(
          'when the condition is disabled there should always be a flag set',
        );
      }

      return {
        disabled: true,
        reason: buildDisabledMessage(
          tool.name,
          `--${conditionCheck.conditionFlag}`,
        ),
      };
    }
  }

  return {disabled: false};
}

export async function createMcpServer(
  serverArgs: ReturnType<typeof parseArguments>,
  options: {
    logFile?: fs.WriteStream;
  },
) {
  const server = new McpServer(
    {
      name: 'ghostframe',
      title: 'Ghostframe stealth MCP server',
      version: VERSION,
    },
    {capabilities: {logging: {}}},
  );
  server.server.setRequestHandler(SetLevelRequestSchema, () => {
    return {};
  });

  const updateRoots = async () => {
    if (!server.server.getClientCapabilities()?.roots) {
      return;
    }
    try {
      const roots = await server.server.request(
        {method: 'roots/list'},
        ListRootsResultSchema,
      );
      context?.setRoots(roots.roots);
    } catch (e) {
      logger('Failed to list roots', e);
    }
  };

  server.server.oninitialized = () => {
    if (server.server.getClientCapabilities()?.roots) {
      void updateRoots();
      server.server.setNotificationHandler(
        RootsListChangedNotificationSchema,
        () => {
          void updateRoots();
        },
      );
    }
  };

  let context: McpContext;
  let ownedBrowser: Browser | undefined;
  let initializing: Promise<McpContext> | undefined;
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;
  function shutdown(): Promise<void> {
    shuttingDown = true;
    shutdownPromise ??= (async () => {
      try {
        await initializing?.catch(error => {
          logger('Context initialization failed during shutdown', error);
        });
        if (context) {
          await context.dispose({closeBrowser: true});
        }
      } finally {
        if (ownedBrowser?.connected) {
          await ownedBrowser.close();
        }
      }
    })();
    return shutdownPromise;
  }
  server.server.onclose = () => {
    void shutdown().catch(error => logger('Browser shutdown failed', error));
  };
  function getContext(): Promise<McpContext> {
    if (shuttingDown) {
      return Promise.reject(new Error('Browser server is shutting down.'));
    }
    initializing ??= initializeContext().finally(() => {
      initializing = undefined;
    });
    return initializing;
  }
  async function initializeContext(): Promise<McpContext> {
    const chromeArgs: string[] = (serverArgs.chromeArg ?? []).map(String);
    const ignoreDefaultChromeArgs: string[] = (
      serverArgs.ignoreDefaultChromeArg ?? []
    ).map(String);
    const proxy = parseProxy(serverArgs.proxyServer, {
      username: process.env.GHOSTFRAME_PROXY_USERNAME,
      password: process.env.GHOSTFRAME_PROXY_PASSWORD,
      allowLegacyCredentials: serverArgs.allowLegacyProxyCredentials,
    });
    if (proxy) {
      chromeArgs.push(`--proxy-server=${proxy.server}`);
    }
    const browser = await ensureBrowserLaunched({
      headless: serverArgs.headless,
      executablePath: serverArgs.executablePath,
      channel: serverArgs.channel as Channel,
      isolated: serverArgs.isolated ?? false,
      userDataDir: serverArgs.userDataDir,
      logFile: options.logFile,
      viewport: serverArgs.viewport,
      chromeArgs,
      ignoreDefaultChromeArgs,
      acceptInsecureCerts: serverArgs.acceptInsecureCerts,
      viaCli: serverArgs.viaCli,
      proxyUsername: proxy?.username,
      proxyPassword: proxy?.password,
    });
    ownedBrowser = browser;

    if (context?.browser !== browser) {
      if (context) {
        await context.dispose();
      }
      context = await McpContext.from(browser, logger, {
        allowUnrestrictedPaths: serverArgs.allowUnrestrictedPaths,
        startupProxy: proxy,
      });
      await updateRoots();
    }
    return context;
  }

  const toolMutex = new Mutex();
  const controlTools = new Set([
    'start_action',
    'get_operation',
    'cancel_operation',
    'arm_interception',
    'read_interception',
    'resolve_interception',
    'debugger_control',
    'inspect_handle',
    'release_handles',
    'start_capture',
    'stop_capture',
    'read_capture',
    'arm_network_wait',
    'read_network_wait',
    'list_network_requests',
    'list_targets',
    'get_proxy',
    'set_proxy',
    'session_cookies',
    'list_pages',
    'new_page',
    'select_page',
    'close_page',
    'handle_dialog',
    'runtime_evaluate',
    'call_handle',
  ]);
  const triggerTools = new Set([
    'click',
    'dblclick',
    'hover',
    'drag',
    'fill',
    'fill_form',
    'upload_file',
    'press_key',
    'type_text',
    'navigate_page',
    'evaluate_script',
    'runtime_evaluate',
    'call_handle',
  ]);

  function registerTool(tool: ToolDefinition | DefinedPageTool): void {
    const {disabled, reason: disabledReason} = getToolStatusInfo(
      tool,
      serverArgs,
    );

    if (disabled && !serverArgs.viaCli) {
      return;
    }

    const schema =
      'pageScoped' in tool && tool.pageScoped
        ? {...tool.schema, ...pageIdSchema}
        : tool.schema;

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: schema,
        annotations: tool.annotations,
      },
      async (params): Promise<CallToolResult> => {
        if (disabledReason) {
          return {
            content: [
              {
                type: 'text',
                text: disabledReason,
              },
            ],
            isError: true,
          };
        }

        const guard = await toolMutex.acquire();
        try {
          logger(
            `${tool.name} request: ${JSON.stringify(redactSensitiveValues(params), null, '  ')}`,
          );
          const context = await getContext();
          logger(`${tool.name} context: resolved`);
          await context.detectOpenDevToolsWindows();
          const response = new McpResponse();

          let actionId: number | undefined;
          let actionPageId: number | undefined;
          try {
            const page = params.pageId
              ? context.getPageById(params.pageId)
              : context.getSelectedMcpPage();
            response.setPage(page);
            actionPageId = page.id;
            if (!controlTools.has(tool.name)) {
              context.getOperationManager().assertAvailable(page.pptrPage);
              if (context.getRuntimeInspector().isPaused(page.pptrPage)) {
                throw new Error(
                  'Page JavaScript is paused. Use debugger_control or resolve_interception before this tool.',
                );
              }
              if (
                triggerTools.has(tool.name) &&
                (context.getRuntimeInspector().hasDebugger(page.pptrPage) ||
                  context.getInterceptionController().isActive(page.pptrPage))
              ) {
                throw new Error(
                  'Use start_action for supported actions, or release the debugger/interception before this tool.',
                );
              }
            }
            actionId = context
              .getNetworkCapture()
              .markAction({tool: tool.name, phase: 'start', pageId: page.id});
            if (tool.blockedByDialog) {
              page.throwIfDialogOpen();
            }
            if ('pageScoped' in tool && tool.pageScoped) {
              await tool.handler(
                {
                  params,
                  page,
                },
                response,
                context,
              );
            } else {
              await tool.handler(
                // @ts-expect-error types do not match.
                {
                  params,
                },
                response,
                context,
              );
            }
          } catch (err) {
            response.setError(err);
          } finally {
            if (actionId !== undefined) {
              context.getNetworkCapture().markAction({
                tool: tool.name,
                phase: 'end',
                pageId: actionPageId,
                actionId,
              });
            }
          }
          const {content, structuredContent} = await response.handle(
            tool.name,
            context,
          );
          const result: CallToolResult & {
            structuredContent?: Record<string, unknown>;
          } = {
            content,
          };
          if (response.error) {
            result.isError = true;
          }
          result.structuredContent = structuredContent as Record<
            string,
            unknown
          >;
          return result;
        } catch (err) {
          logger(`${tool.name} error:`, err, err?.stack);
          let errorText = err && 'message' in err ? err.message : String(err);
          if ('cause' in err && err.cause) {
            errorText += `\nCause: ${err.cause.message}`;
          }
          return {
            content: [
              {
                type: 'text',
                text: errorText,
              },
            ],
            isError: true,
          };
        } finally {
          guard.dispose();
        }
      },
    );
  }

  const tools = createTools(serverArgs);
  for (const tool of tools) {
    registerTool(tool);
  }

  await loadIssueDescriptions();

  return {server, shutdown};
}

export const logDisclaimers = () => {
  console.error(
    `ghostframe-mcp exposes content of the browser instance to the MCP clients allowing them to inspect,
debug, and modify any data in the browser or DevTools.
Avoid sharing sensitive or personal information that you do not want to share with MCP clients.`,
  );
};

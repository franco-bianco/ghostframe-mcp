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
  async function getContext(): Promise<McpContext> {
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

    if (context?.browser !== browser) {
      context = await McpContext.from(browser, logger, {
        allowUnrestrictedPaths: serverArgs.allowUnrestrictedPaths,
      });
      await updateRoots();
    }
    return context;
  }

  const toolMutex = new Mutex();

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
          try {
            const page = params.pageId
              ? context.getPageById(params.pageId)
              : context.getSelectedMcpPage();
            response.setPage(page);
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

  return {server};
}

export const logDisclaimers = () => {
  console.error(
    `ghostframe-mcp exposes content of the browser instance to the MCP clients allowing them to inspect,
debug, and modify any data in the browser or DevTools.
Avoid sharing sensitive or personal information that you do not want to share with MCP clients.`,
  );
};

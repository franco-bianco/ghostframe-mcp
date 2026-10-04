/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {before, describe, it} from 'node:test';

import type {Dialog} from 'puppeteer-core';

import {loadIssueDescriptions} from '../../src/issue-descriptions.js';
import {McpResponse} from '../../src/McpResponse.js';
import {TextSnapshot} from '../../src/TextSnapshot.js';
import {DevTools} from '../../src/third_party/index.js';
import {
  getConsoleMessage,
  listConsoleMessages,
} from '../../src/tools/console.js';
import {serverHooks} from '../server.js';
import {
  getTextContent,
  withMcpContext,
  stabilizeStructuredContent,
} from '../utils.js';

describe('console', () => {
  before(async () => {
    await loadIssueDescriptions();
  });
  describe('list_console_messages', () => {
    it('collects messages while stealth is enabled', async () => {
      await withMcpContext(
        async (response, context) => {
          const page = context.getSelectedMcpPage();
          await page.pptrPage.setContent(
            '<script>console.error("stealth console check")</script>',
          );
          await listConsoleMessages().handler(
            {params: {}, page: context.getSelectedMcpPage()},
            response,
            context,
          );
          const formattedResponse = await response.handle('test', context);
          const textContent = getTextContent(formattedResponse.content[0]);
          assert.ok(textContent.includes('stealth console check'));
        },
        {stealth: true},
      );
    });

    it('lists error messages', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedMcpPage();
        await page.pptrPage.setContent(
          '<script>console.error("This is an error")</script>',
        );
        await listConsoleMessages().handler(
          {params: {}, page: context.getSelectedMcpPage()},
          response,
          context,
        );
        const formattedResponse = await response.handle('test', context);
        const textContent = getTextContent(formattedResponse.content[0]);
        assert.ok(textContent.includes('msgid=1 [error] This is an error'));
      });
    });

    it('lists error objects', async t => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedMcpPage();
        await page.pptrPage.setContent(
          '<script>console.error(new Error("This is an error"))</script>',
        );
        await listConsoleMessages().handler(
          {params: {}, page: context.getSelectedMcpPage()},
          response,
          context,
        );
        const formattedResponse = await response.handle('test', context);
        const textContent = getTextContent(formattedResponse.content[0]);
        t.assert.snapshot?.(textContent);
      });
    });

    it('work with primitive unhandled errors', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedMcpPage();
        await page.pptrPage.setContent('<script>throw undefined;</script>');
        await listConsoleMessages().handler(
          {params: {}, page: context.getSelectedMcpPage()},
          response,
          context,
        );
        const formattedResponse = await response.handle('test', context);
        const textContent = getTextContent(formattedResponse.content[0]);
        assert.ok(textContent.includes('msgid=1 [error] Uncaught  (0 args)'));
      });
    });

    describe('issues', () => {
      it('lists issues', async () => {
        await withMcpContext(async (response, context) => {
          const page = context.getSelectedMcpPage();
          const issuePromise = new Promise<void>(resolve => {
            page.pptrPage.once('issue', () => {
              resolve();
            });
          });
          await page.pptrPage.setContent(
            '<input type="text" name="username" />',
          );
          await issuePromise;
          await listConsoleMessages().handler(
            {params: {}, page: context.getSelectedMcpPage()},
            response,
            context,
          );
          const formattedResponse = await response.handle('test', context);
          const textContent = getTextContent(formattedResponse.content[0]);
          assert.ok(
            textContent.includes(
              `msgid=1 [issue] An element doesn't have an autocomplete attribute (count: 1)`,
            ),
          );
        });
      });

      it('lists issues after a page reload', async () => {
        await withMcpContext(async (response, context) => {
          const page = await context.newPage();
          response.setPage(page);
          const issuePromise = new Promise<void>(resolve => {
            page.pptrPage.once('issue', () => {
              resolve();
            });
          });

          await page.pptrPage.setContent(
            '<input type="text" name="username" />',
          );
          await issuePromise;
          await listConsoleMessages().handler(
            {params: {}, page: context.getSelectedMcpPage()},
            response,
            context,
          );
          {
            const formattedResponse = await response.handle('test', context);
            const textContent = getTextContent(formattedResponse.content[0]);
            assert.ok(
              textContent.includes(
                `msgid=1 [issue] An element doesn't have an autocomplete attribute (count: 1)`,
              ),
            );
          }

          const anotherIssuePromise = new Promise<void>(resolve => {
            page.pptrPage.once('issue', () => {
              resolve();
            });
          });
          await page.pptrPage.reload();
          await page.pptrPage.setContent(
            '<input type="text" name="username" />',
          );
          await anotherIssuePromise;
          {
            const formattedResponse = await response.handle('test', context);
            const textContent = getTextContent(formattedResponse.content[0]);
            assert.ok(
              textContent.includes(
                `msgid=2 [issue] An element doesn't have an autocomplete attribute (count: 1)`,
              ),
            );
          }
        });
      });

      it('when dialog is open', async t => {
        await withMcpContext(async (response, context) => {
          const page = context.getSelectedPptrPage();
          await page.setContent(
            '<script>console.log("Pre-dialog message")</script>',
          );

          const dialogPromise = new Promise<Dialog>(resolve => {
            page.on('dialog', dialog => resolve(dialog));
          });

          page.evaluate(() => {
            alert('test dialog');
          });
          const dialog = await dialogPromise;

          await listConsoleMessages().handler(
            {params: {}, page: context.getSelectedMcpPage()},
            response,
            context,
          );

          const result = await response.handle(
            'list_console_messages',
            context,
          );
          t.assert.snapshot?.(JSON.stringify(result));
          await dialog.dismiss();
        });
      });
    });
  });

  describe('get_console_message', () => {
    const server = serverHooks();

    it('gets a specific console message', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedMcpPage();
        await page.pptrPage.setContent(
          '<script>console.error("This is an error")</script>',
        );
        // The list is needed to populate the console messages in the context.
        await listConsoleMessages().handler(
          {params: {}, page: context.getSelectedMcpPage()},
          response,
          context,
        );
        await getConsoleMessage.handler(
          {params: {msgid: 1}, page: context.getSelectedMcpPage()},
          response,
          context,
        );
        const formattedResponse = await response.handle('test', context);
        const textContent = getTextContent(formattedResponse.content[0]);
        assert.ok(
          textContent.includes('msgid=1 [error] This is an error'),
          'Should contain console message body',
        );
      });
    });

    describe('issues type', () => {
      it('gets issue details with node id parsing', async t => {
        await withMcpContext(async (response, context) => {
          const page = context.getSelectedMcpPage();
          const issuePromise = new Promise<void>(resolve => {
            page.pptrPage.once('issue', () => {
              resolve();
            });
          });
          await page.pptrPage.setContent(
            '<input type="text" name="username" />',
          );
          page.textSnapshot = await TextSnapshot.create(page);
          await issuePromise;
          await listConsoleMessages().handler(
            {params: {}, page: context.getSelectedMcpPage()},
            response,
            context,
          );
          const response2 = new McpResponse();
          response2.setPage(context.getSelectedMcpPage());
          await getConsoleMessage.handler(
            {params: {msgid: 1}, page: context.getSelectedMcpPage()},
            response2,
            context,
          );
          const formattedResponse = await response2.handle('test', context);
          t.assert.snapshot?.(getTextContent(formattedResponse.content[0]));
        });
      });
      it('gets issue details with request id parsing', async t => {
        server.addRoute('/data.json', (_req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({data: 'test data'}));
        });

        await withMcpContext(async (response, context) => {
          const page = context.getSelectedMcpPage();
          const issuePromise = new Promise<void>(resolve => {
            page.pptrPage.once('issue', () => {
              resolve();
            });
          });

          const url = server.getRoute('/data.json');
          await page.pptrPage.setContent(`
            <script>
              fetch('${url}', {
                  method: 'GET',
                  headers: {
                      'Content-Type': 'application/json',
                      'X-Custom-Header': 'MyValue'
                  }
              });
            </script>
          `);
          page.textSnapshot = await TextSnapshot.create(page);
          await issuePromise;
          const messages = context.getConsoleData(page);
          let issueMsg;
          for (const message of messages) {
            if (message instanceof DevTools.AggregatedIssue) {
              issueMsg = message;
              break;
            }
          }
          assert.ok(issueMsg);
          const id = context.getConsoleMessageStableId(issueMsg);
          assert.ok(id);
          await listConsoleMessages().handler(
            {params: {types: ['issue']}, page: context.getSelectedMcpPage()},
            response,
            context,
          );
          const response2 = new McpResponse();
          response2.setPage(context.getSelectedMcpPage());
          await getConsoleMessage.handler(
            {params: {msgid: id}, page: context.getSelectedMcpPage()},
            response2,
            context,
          );
          const formattedResponse = await response2.handle('test', context);
          const rawText = getTextContent(formattedResponse.content[0]);
          const sanitizedText = rawText
            .replaceAll(/ID: \d+/g, 'ID: <ID>')
            .replaceAll(/reqid=\d+/g, 'reqid=<reqid>')
            .replaceAll(/localhost:\d+/g, 'hostname:port');
          t.assert.snapshot?.(sanitizedText);
        });
      });
    });

    it('returns the type and message of an Error console argument', async () => {
      await withMcpContext(async (response, context) => {
        await context.getSelectedPptrPage().evaluate(() => {
          console.log('Request failed:', new TypeError('Invalid payload'));
        });
        await getConsoleMessage.handler(
          {params: {msgid: 1}, page: context.getSelectedMcpPage()},
          response,
          context,
        );
        const result = await response.handle('get_console_message', context);
        const text = getTextContent(result.content[0]);
        assert.ok(text.includes('Request failed:'));
        assert.ok(text.includes('TypeError: Invalid payload'));
        assert.ok(text.includes('### Arguments'));
      });
    });

    it('when dialog is open', async t => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        await page.setContent(
          '<script>console.error("This is an error")</script>',
        );

        await listConsoleMessages().handler(
          {params: {}, page: context.getSelectedMcpPage()},
          response,
          context,
        );

        const dialogPromise = new Promise<Dialog>(resolve => {
          page.on('dialog', dialog => resolve(dialog));
        });
        page.evaluate(() => {
          alert('test dialog');
        });
        const dialog = await dialogPromise;

        await getConsoleMessage.handler(
          {params: {msgid: 1}, page: context.getSelectedMcpPage()},
          response,
          context,
        );

        const result = await response.handle('get_console_message', context);
        t.assert.snapshot?.(
          JSON.stringify(
            stabilizeStructuredContent(result.structuredContent),
            null,
            2,
          ),
        );
        await dialog.dismiss();
      });
    });
  });
});

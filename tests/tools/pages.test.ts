/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import type {Dialog} from 'puppeteer-core';

import {
  listPages,
  newPage,
  closePage,
  selectPage,
  navigatePage,
  resizePage,
  handleDialog,
} from '../../src/tools/pages.js';
import {evaluateScript} from '../../src/tools/script.js';
import {serverHooks} from '../server.js';
import {html, withMcpContext} from '../utils.js';

describe('pages', () => {
  const server = serverHooks();

  describe('list_pages', () => {
    it('list pages', async () => {
      await withMcpContext(async (response, context) => {
        await listPages().handler({params: {}}, response, context);
        const result = await response.handle('list_pages', context);
        assert.ok(
          'pages' in result.structuredContent &&
            Array.isArray(result.structuredContent.pages),
        );
        const pages: unknown[] = result.structuredContent.pages;
        assert.strictEqual(pages.length, 1);
        const entry = pages[0];
        assert.ok(
          entry && typeof entry === 'object' && 'id' in entry && entry.id === 1,
        );
        assert.ok('selected' in entry && entry.selected === true);
      });
    });
    it('list pages after selected page is closed', async () => {
      await withMcpContext(async (response, context) => {
        // Create a second page and select it.
        const page2 = await context.newPage();
        assert.strictEqual(context.getSelectedMcpPage(), page2);

        // Close the selected page via puppeteer (simulating external close).
        await page2.pptrPage.close();

        // list_pages should still work even though the selected page is gone.
        await listPages().handler({params: {}}, response, context);
        const result = await response.handle('list_pages', context);
        assert.ok(
          'pages' in result.structuredContent &&
            Array.isArray(result.structuredContent.pages),
        );
        const pages: unknown[] = result.structuredContent.pages;
        assert.strictEqual(pages.length, 1);
        const entry = pages[0];
        assert.ok(
          entry && typeof entry === 'object' && 'id' in entry && entry.id === 1,
        );
        assert.ok('selected' in entry && entry.selected === true);
      });
    });

    it('when dialog is open', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        const dialogPromise = new Promise<Dialog>(resolve => {
          page.on('dialog', dialog => {
            resolve(dialog);
          });
        });

        page.evaluate(() => {
          alert('test dialog');
        });
        const dialog = await dialogPromise;

        await listPages().handler({params: {}}, response, context);

        const result = await response.handle('list_pages', context);
        assert.ok(
          'pages' in result.structuredContent &&
            Array.isArray(result.structuredContent.pages),
        );
        assert.ok('dialog' in result.structuredContent);
        assert.ok(
          JSON.stringify(result.structuredContent.dialog).includes(
            'test dialog',
          ),
        );
        await dialog.dismiss();
      });
    });
  });
  describe('new_page', () => {
    it('creates, loads and selects the requested page', async () => {
      await withMcpContext(async (response, context) => {
        await newPage().handler(
          {params: {url: 'data:text/html,<title>Fresh page</title>'}},
          response,
          context,
        );
        const output = await response.handle('new_page', context);
        assert.ok(
          'pages' in output.structuredContent &&
            Array.isArray(output.structuredContent.pages),
        );
        const pages: unknown[] = output.structuredContent.pages;
        assert.strictEqual(pages.length, 2);
        const created = pages[1];
        assert.ok(
          created &&
            typeof created === 'object' &&
            'selected' in created &&
            created.selected === true,
        );
        response.resetResponseLineForTesting();
        await evaluateScript().handler(
          {params: {function: '() => document.title'}},
          response,
          context,
        );
        assert.strictEqual(
          JSON.parse(
            response.responseLines.at(2) ?? assert.fail('Missing result'),
          ),
          'Fresh page',
        );
      });
    });
    it('create a page in the background', async () => {
      await withMcpContext(async (response, context) => {
        const originalPage = context.getPageById(1);
        assert.strictEqual(originalPage, context.getSelectedMcpPage());
        // Ensure original page has focus
        await originalPage.pptrPage.bringToFront();
        assert.strictEqual(
          await originalPage.pptrPage.evaluate(() => document.hasFocus()),
          true,
        );
        await newPage().handler(
          {params: {url: 'about:blank', background: true}},
          response,
          context,
        );
        // New page should be selected but original should retain focus
        assert.strictEqual(
          context.getPageById(2),
          context.getSelectedMcpPage(),
        );
        assert.strictEqual(
          await originalPage.pptrPage.evaluate(() => document.hasFocus()),
          true,
        );
      });
    });
  });
  describe('new_page with isolatedContext', () => {
    it('shares cookies within a named context and isolates different names and the default context', async () => {
      server.addHtmlRoute('/sessions', html`<main>Sessions</main>`);
      await withMcpContext(async (response, context) => {
        const original = context.getSelectedPptrPage();
        await original.goto(server.getRoute('/sessions'));
        await original.evaluate(() => {
          document.cookie = 'session=default; path=/';
        });
        await newPage().handler(
          {
            params: {
              url: server.getRoute('/sessions'),
              isolatedContext: 'session-a',
            },
          },
          response,
          context,
        );
        const first = context.getSelectedPptrPage();
        assert.strictEqual(await first.evaluate(() => document.cookie), '');
        await first.evaluate(() => {
          document.cookie = 'session=alice; path=/';
        });
        await newPage().handler(
          {
            params: {
              url: server.getRoute('/sessions'),
              isolatedContext: 'session-a',
            },
          },
          response,
          context,
        );
        assert.strictEqual(
          await context.getSelectedPptrPage().evaluate(() => document.cookie),
          'session=alice',
        );
        await newPage().handler(
          {
            params: {
              url: server.getRoute('/sessions'),
              isolatedContext: 'session-b',
            },
          },
          response,
          context,
        );
        assert.strictEqual(
          await context.getSelectedPptrPage().evaluate(() => document.cookie),
          '',
        );
        assert.strictEqual(
          await original.evaluate(() => document.cookie),
          'session=default',
        );
      });
    });

    it('includes isolatedContext in page listing', async () => {
      await withMcpContext(async (response, context) => {
        await newPage().handler(
          {params: {url: 'about:blank', isolatedContext: 'session-a'}},
          response,
          context,
        );
        const result = await response.handle('new_page', context);
        assert.ok(
          'pages' in result.structuredContent &&
            Array.isArray(result.structuredContent.pages),
        );
        const pages: unknown[] = result.structuredContent.pages;
        const isolatedPage = pages.find(
          p =>
            p &&
            typeof p === 'object' &&
            'isolatedContext' in p &&
            p.isolatedContext === 'session-a',
        );
        assert.ok(isolatedPage);
      });
    });

    it('closes an isolated page without errors', async () => {
      await withMcpContext(async (response, context) => {
        await newPage().handler(
          {params: {url: 'about:blank', isolatedContext: 'session-a'}},
          response,
          context,
        );
        const page = context.getSelectedPptrPage();
        const pageId = context.getPageId(page);
        assert.ok(typeof pageId === 'number');
        assert.ok(!page.isClosed());
        await closePage.handler({params: {pageId}}, response, context);
        assert.ok(page.isClosed());
      });
    });

    it('when dialog is open', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        const dialogPromise = new Promise<Dialog>(resolve => {
          page.on('dialog', dialog => {
            resolve(dialog);
          });
        });

        page.evaluate(() => {
          alert('test dialog');
        });
        const dialog = await dialogPromise;

        await newPage().handler(
          {params: {url: 'about:blank'}},
          response,
          context,
        );

        const result = await response.handle('new_page', context);
        assert.ok(
          'pages' in result.structuredContent &&
            Array.isArray(result.structuredContent.pages),
        );
        assert.strictEqual(result.structuredContent.pages.length, 2);
        await dialog.dismiss();
      });
    });
  });

  it('navigate_page targets the pageId page, not the global selection', async () => {
    await withMcpContext(async (response, context) => {
      await newPage().handler(
        {
          params: {
            url: 'data:text/html,<h1>Initial</h1>',
            isolatedContext: 'nav-ctx',
          },
        },
        response,
        context,
      );
      const isolatedPage = context.getSelectedMcpPage();

      // Switch global selection back to the default page.
      await selectPage.handler({params: {pageId: 1}}, response, context);
      assert.notStrictEqual(context.getSelectedMcpPage(), isolatedPage);

      // Navigate using page; should target the isolated page.
      await navigatePage().handler(
        {
          params: {
            url: 'data:text/html,<h1>Navigated</h1>',
          },
          page: isolatedPage,
        },
        response,
        context,
      );

      // Verify the isolated page was navigated.
      const content = await isolatedPage.pptrPage.evaluate(
        () => document.querySelector('h1')?.textContent,
      );
      assert.strictEqual(content, 'Navigated');

      // Verify the default page was NOT affected.
      const defaultContent = await context
        .getSelectedPptrPage()
        .evaluate(() => document.querySelector('h1')?.textContent);
      assert.notStrictEqual(defaultContent, 'Navigated');
    });
  });

  describe('close_page', () => {
    it('closes a page', async () => {
      await withMcpContext(async (response, context) => {
        const page = await context.newPage();
        assert.strictEqual(
          context.getPageById(2),
          context.getSelectedMcpPage(),
        );
        assert.strictEqual(context.getPageById(2), page);
        await closePage.handler({params: {pageId: 2}}, response, context);
        assert.ok(page.pptrPage.isClosed());
      });
    });
    it('cannot close the last page', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        await closePage.handler({params: {pageId: 1}}, response, context);
        assert.deepStrictEqual(
          response.responseLines[0],
          `The last open page cannot be closed. It is fine to keep it open.`,
        );

        assert.ok(!page.isClosed());
      });
    });

    it('when dialog is open', async () => {
      await withMcpContext(async (response, context) => {
        const page = await context.newPage();
        assert.strictEqual(
          context.getPageById(2),
          context.getSelectedMcpPage(),
        );
        assert.strictEqual(context.getPageById(2), page);

        const dialogPromise = new Promise<void>(resolve => {
          page.pptrPage.on('dialog', () => resolve());
        });

        page.pptrPage
          .evaluate(() => {
            alert('test dialog');
          })
          .catch(() => {
            // Ignore TargetCloseError when page is closed with open dialog
          });
        await dialogPromise;

        await closePage.handler({params: {pageId: 2}}, response, context);

        const result = await response.handle('close_page', context);
        assert.ok(page.pptrPage.isClosed());
        assert.ok(
          'pages' in result.structuredContent &&
            Array.isArray(result.structuredContent.pages),
        );
        assert.strictEqual(result.structuredContent.pages.length, 1);
      });
    });
  });
  describe('select_page', () => {
    it('routes subsequent evaluation to the selected page', async () => {
      await withMcpContext(async (response, context) => {
        await context
          .getSelectedPptrPage()
          .setContent('<title>Original page</title>');
        const other = await context.newPage();
        await other.pptrPage.setContent('<title>Other page</title>');
        await selectPage.handler({params: {pageId: 1}}, response, context);
        response.resetResponseLineForTesting();
        await evaluateScript().handler(
          {params: {function: '() => document.title'}},
          response,
          context,
        );
        assert.strictEqual(
          JSON.parse(
            response.responseLines.at(2) ?? assert.fail('Missing result'),
          ),
          'Original page',
        );
      });
    });
    it('selects a page and keeps it focused in the background', async () => {
      await withMcpContext(async (response, context) => {
        await context.newPage();
        assert.strictEqual(
          context.getPageById(2),
          context.getSelectedMcpPage(),
        );
        assert.strictEqual(
          await context
            .getPageById(1)
            .pptrPage.evaluate(() => document.hasFocus()),
          true,
        );
        await selectPage.handler({params: {pageId: 1}}, response, context);
        assert.strictEqual(
          context.getPageById(1),
          context.getSelectedMcpPage(),
        );
        assert.strictEqual(
          await context
            .getPageById(1)
            .pptrPage.evaluate(() => document.hasFocus()),
          true,
        );
      });
    });
    it('preserves focus across different browser contexts', async () => {
      await withMcpContext(async (response, context) => {
        // Create pages in separate isolated contexts.
        await newPage().handler(
          {params: {url: 'about:blank', isolatedContext: 'ctx-a'}},
          response,
          context,
        );
        const pageA = context.getSelectedPptrPage();
        const pageAId = context.getPageId(pageA);
        assert.ok(typeof pageAId === 'number');

        await newPage().handler(
          {params: {url: 'about:blank', isolatedContext: 'ctx-b'}},
          response,
          context,
        );
        const pageB = context.getSelectedPptrPage();

        // Selecting pageB (ctx-b) should not defocus pageA (ctx-a).
        assert.strictEqual(
          await pageA.evaluate(() => document.hasFocus()),
          true,
        );
        assert.strictEqual(
          await pageB.evaluate(() => document.hasFocus()),
          true,
        );

        // Switching back to pageA should preserve pageB's focus.
        await selectPage.handler(
          {params: {pageId: pageAId}},
          response,
          context,
        );
        assert.strictEqual(
          await pageA.evaluate(() => document.hasFocus()),
          true,
        );
        assert.strictEqual(
          await pageB.evaluate(() => document.hasFocus()),
          true,
        );
      });
    });

    it('when dialog is open', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        const dialogPromise = new Promise<Dialog>(resolve => {
          page.on('dialog', dialog => {
            resolve(dialog);
          });
        });

        page.evaluate(() => {
          alert('test dialog');
        });
        const dialog = await dialogPromise;

        await selectPage.handler({params: {pageId: 1}}, response, context);

        const result = await response.handle('select_page', context);
        assert.ok('dialog' in result.structuredContent);
        assert.strictEqual(context.getSelectedPptrPage(), page);
        await dialog.dismiss();
      });
    });
  });
  describe('navigate_page', () => {
    it('navigates to correct page', async () => {
      await withMcpContext(async (response, context) => {
        await navigatePage().handler(
          {
            params: {url: 'data:text/html,<div>Hello MCP</div>'},
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );
        const page = context.getSelectedPptrPage();
        assert.equal(
          await page.evaluate(() => document.querySelector('div')?.textContent),
          'Hello MCP',
        );
      });
    });

    it('throws an error if the page was closed not by the MCP server', async () => {
      await withMcpContext(async (response, context) => {
        const page = await context.newPage();
        assert.strictEqual(
          context.getPageById(2),
          context.getSelectedMcpPage(),
        );
        assert.strictEqual(context.getPageById(2), page);

        await page.pptrPage.close();

        try {
          await navigatePage().handler(
            {
              params: {url: 'data:text/html,<div>Hello MCP</div>'},
              page: context.getSelectedMcpPage(),
            },
            response,
            context,
          );
          assert.fail('should not reach here');
        } catch (err) {
          assert.strictEqual(
            err.message,
            'The selected page has been closed. Call list_pages to see open pages.',
          );
        }
      });
    });

    it('bounds a navigation whose server never responds', async () => {
      server.addRoute('/stalled', (_req, _res) => {
        // Keep the HTTP response pending until the test server shuts down.
      });
      await withMcpContext(async (response, context) => {
        const started = Date.now();
        await navigatePage().handler(
          {
            params: {url: server.getRoute('/stalled'), timeout: 150},
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );
        assert.ok(Date.now() - started < 5000);
        assert.ok(response.responseLines.some(line => /timeout/i.test(line)));
      });
    });
    it('go back', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        await page.goto('data:text/html,<div>Hello MCP</div>');
        await navigatePage().handler(
          {params: {type: 'back'}, page: context.getSelectedMcpPage()},
          response,
          context,
        );

        assert.equal(
          await page.evaluate(() => document.location.href),
          'about:blank',
        );
      });
    });
    it('go forward', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        await page.goto('data:text/html,<div>Hello MCP</div>');
        await page.goBack();
        await navigatePage().handler(
          {params: {type: 'forward'}, page: context.getSelectedMcpPage()},
          response,
          context,
        );

        assert.equal(
          await page.evaluate(() => document.querySelector('div')?.textContent),
          'Hello MCP',
        );
      });
    });
    it('reload', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        await page.goto('data:text/html,<div>Hello MCP</div>');
        await navigatePage().handler(
          {params: {type: 'reload'}, page: context.getSelectedMcpPage()},
          response,
          context,
        );

        assert.equal(
          await page.evaluate(() => document.location.href),
          'data:text/html,<div>Hello MCP</div>',
        );
      });
    });

    it('reload with accpeting the beforeunload dialog', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        await page.setContent(
          html` <script>
            window.addEventListener('beforeunload', e => {
              e.preventDefault();
              e.returnValue = '';
            });
          </script>`,
        );

        await navigatePage().handler(
          {params: {type: 'reload'}, page: context.getSelectedMcpPage()},
          response,
          context,
        );

        assert.strictEqual(context.getSelectedMcpPage().getDialog(), undefined);

        assert.strictEqual(
          response.responseLines.join('\n'),
          'Accepted a beforeunload dialog.\nSuccessfully reloaded the page.',
        );
      });
    });

    it('reload with declining the beforeunload dialog', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        await page.setContent(
          html` <script>
            window.addEventListener('beforeunload', e => {
              e.preventDefault();
              e.returnValue = '';
            });
          </script>`,
        );

        await navigatePage().handler(
          {
            params: {
              type: 'reload',
              handleBeforeUnload: 'decline',
              timeout: 500,
            },
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );

        assert.strictEqual(context.getSelectedMcpPage().getDialog(), undefined);

        assert.strictEqual(
          response.responseLines.join('\n'),
          'Declined a beforeunload dialog.\nUnable to reload the selected page: Navigation timeout of 500 ms exceeded.',
        );
      });
    });

    it('go forward with error', async () => {
      await withMcpContext(async (response, context) => {
        await navigatePage().handler(
          {params: {type: 'forward'}, page: context.getSelectedMcpPage()},
          response,
          context,
        );

        assert.ok(
          response.responseLines
            .at(0)
            ?.startsWith('Unable to navigate forward in the selected page:'),
        );
      });
    });
    it('go back with error', async () => {
      await withMcpContext(async (response, context) => {
        await navigatePage().handler(
          {params: {type: 'back'}, page: context.getSelectedMcpPage()},
          response,
          context,
        );

        assert.ok(
          response.responseLines
            .at(0)
            ?.startsWith('Unable to navigate back in the selected page:'),
        );
      });
    });
    it('navigates to correct page with initScript', async () => {
      await withMcpContext(async (response, context) => {
        await navigatePage().handler(
          {
            params: {
              url: 'data:text/html,<script>document.title = window.initScript || "missing"</script>',
              initScript: 'window.initScript = "completed"',
            },
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );
        const page = context.getSelectedPptrPage();

        // wait for up to 1s for the global variable to set by the initScript to exist
        assert.strictEqual(await page.title(), 'completed');
        await page.goto(
          'data:text/html,<script>document.title = window.initScript || "missing"</script>',
        );
        assert.strictEqual(await page.title(), 'missing');
      });
    });

    it('when dialog is open', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        const dialogPromise = new Promise<void>(resolve => {
          page.on('dialog', () => resolve());
        });

        page.evaluate(() => {
          alert('test dialog');
        });
        await dialogPromise;

        await navigatePage().handler(
          {
            params: {url: 'data:text/html,<div>Navigated</div>'},
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );

        await response.handle('navigate_page', context);
        assert.strictEqual(
          await page.evaluate(() => document.querySelector('div')?.textContent),
          'Navigated',
        );
      });
    });
  });
  describe('resize', () => {
    it('resize the page', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        const resizePromise = page.evaluate(() => {
          return new Promise(resolve => {
            window.addEventListener('resize', resolve, {once: true});
          });
        });
        await resizePage.handler(
          {
            params: {width: 700, height: 500},
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );
        await resizePromise;
        await page.waitForFunction(
          () => window.innerWidth === 700 && window.innerHeight === 500,
        );
        const dimensions = await page.evaluate(() => {
          return [window.innerWidth, window.innerHeight];
        });
        assert.deepStrictEqual(dimensions, [700, 500]);
      });
    });

    it('resize when window state is normal', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        const browser = page.browser();
        const windowId = await page.windowId();
        await browser.setWindowBounds(windowId, {windowState: 'normal'});

        const {windowState} = await browser.getWindowBounds(windowId);
        assert.strictEqual(windowState, 'normal');

        const resizePromise = page.evaluate(() => {
          return new Promise(resolve => {
            window.addEventListener('resize', resolve, {once: true});
          });
        });
        await resizePage.handler(
          {
            params: {width: 650, height: 450},
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );
        await resizePromise;
        await page.waitForFunction(
          () => window.innerWidth === 650 && window.innerHeight === 450,
        );
        const dimensions = await page.evaluate(() => {
          return [window.innerWidth, window.innerHeight];
        });
        assert.deepStrictEqual(dimensions, [650, 450]);
      });
    });

    it('resize when window state is minimized', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        const browser = page.browser();
        const windowId = await page.windowId();
        await browser.setWindowBounds(windowId, {windowState: 'minimized'});

        const {windowState} = await browser.getWindowBounds(windowId);
        assert.strictEqual(windowState, 'minimized');

        const resizePromise = page.evaluate(() => {
          return new Promise(resolve => {
            window.addEventListener('resize', resolve, {once: true});
          });
        });
        await resizePage.handler(
          {
            params: {width: 750, height: 550},
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );
        await resizePromise;
        await page.waitForFunction(
          () => window.innerWidth === 750 && window.innerHeight === 550,
        );
        const dimensions = await page.evaluate(() => {
          return [window.innerWidth, window.innerHeight];
        });
        assert.deepStrictEqual(dimensions, [750, 550]);
      });
    });

    it('resize when window state is maximized', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        const browser = page.browser();
        const windowId = await page.windowId();
        await browser.setWindowBounds(windowId, {windowState: 'maximized'});

        const {windowState} = await browser.getWindowBounds(windowId);
        assert.strictEqual(windowState, 'maximized');

        const resizePromise = page.evaluate(() => {
          return new Promise(resolve => {
            window.addEventListener('resize', resolve, {once: true});
          });
        });
        await resizePage.handler(
          {
            params: {width: 725, height: 525},
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );
        await resizePromise;
        await page.waitForFunction(
          () => window.innerWidth === 725 && window.innerHeight === 525,
        );
        const dimensions = await page.evaluate(() => {
          return [window.innerWidth, window.innerHeight];
        });
        assert.deepStrictEqual(dimensions, [725, 525]);
      });
    });

    it('resize when window state is fullscreen', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        const browser = page.browser();
        const windowId = await page.windowId();
        await browser.setWindowBounds(windowId, {windowState: 'fullscreen'});

        const {windowState} = await browser.getWindowBounds(windowId);
        assert.strictEqual(windowState, 'fullscreen');

        const resizePromise = page.evaluate(() => {
          return new Promise(resolve => {
            window.addEventListener('resize', resolve, {once: true});
          });
        });
        await resizePage.handler(
          {
            params: {width: 850, height: 650},
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );
        await resizePromise;
        await page.waitForFunction(
          () => window.innerWidth === 850 && window.innerHeight === 650,
        );
        const dimensions = await page.evaluate(() => {
          return [window.innerWidth, window.innerHeight];
        });
        assert.deepStrictEqual(dimensions, [850, 650]);
      });
    });

    it('when dialog is open', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        const dialogPromise = new Promise<Dialog>(resolve => {
          page.on('dialog', dialog => {
            resolve(dialog);
          });
        });

        page.evaluate(() => {
          alert('test dialog');
        });
        const dialog = await dialogPromise;

        await resizePage.handler(
          {
            params: {width: 1600, height: 1400},
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );

        const result = await response.handle('resize_page', context);
        assert.ok('dialog' in result.structuredContent);
        await dialog.dismiss();
        assert.deepStrictEqual(
          await page.evaluate(() => [innerWidth, innerHeight]),
          [1600, 1400],
        );
      });
    });
  });

  describe('dialogs', () => {
    it('returns the accepted or dismissed confirmation to page JavaScript', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedMcpPage();
        const actions: Array<'accept' | 'dismiss'> = ['accept', 'dismiss'];
        for (const action of actions) {
          const opened = new Promise<void>(resolve =>
            page.pptrPage.once('dialog', () => resolve()),
          );
          const result = page.pptrPage.evaluate(() => confirm('Continue?'));
          await opened;
          await handleDialog.handler(
            {params: {action}, page},
            response,
            context,
          );
          assert.strictEqual(await result, action === 'accept');
        }
      });
    });

    it('handles an externally dismissed dialog without repeating its effect', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedMcpPage();
        const opened = new Promise<Dialog>(resolve =>
          page.pptrPage.once('dialog', resolve),
        );
        const result = page.pptrPage.evaluate(() => confirm('Continue?'));
        await (await opened).dismiss();
        await handleDialog.handler(
          {params: {action: 'dismiss'}, page},
          response,
          context,
        );
        assert.strictEqual(await result, false);
      });
    });

    it('routes independent prompt dialogs to their owning pages', async () => {
      await withMcpContext(async (response, context) => {
        const first = context.getSelectedMcpPage();
        const second = await context.newPage();
        const firstOpened = new Promise<void>(resolve =>
          first.pptrPage.once('dialog', () => resolve()),
        );
        const firstResult = first.pptrPage.evaluate(() =>
          prompt('First session?'),
        );
        await firstOpened;
        const secondOpened = new Promise<void>(resolve =>
          second.pptrPage.once('dialog', () => resolve()),
        );
        const secondResult = second.pptrPage.evaluate(() =>
          prompt('Second session?'),
        );
        await secondOpened;
        await handleDialog.handler(
          {params: {action: 'accept', promptText: 'alice'}, page: first},
          response,
          context,
        );
        assert.strictEqual(await firstResult, 'alice');
        assert.strictEqual(second.getDialog()?.message(), 'Second session?');
        await handleDialog.handler(
          {params: {action: 'dismiss'}, page: second},
          response,
          context,
        );
        assert.strictEqual(await secondResult, null);
      });
    });
  });
});

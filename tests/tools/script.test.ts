/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {TextSnapshot} from '../../src/TextSnapshot.js';
import {evaluateScript} from '../../src/tools/script.js';
import {serverHooks} from '../server.js';
import {html, withMcpContext} from '../utils.js';

describe('script', () => {
  const server = serverHooks();

  describe('browser_evaluate_script', () => {
    it('evaluates', async () => {
      await withMcpContext(async (response, context) => {
        await evaluateScript().handler(
          {
            params: {function: String(() => 2 * 5)},
          },
          response,
          context,
        );
        const lineEvaluation =
          response.responseLines.at(2) ??
          assert.fail('Missing serialized evaluation result');
        assert.strictEqual(JSON.parse(lineEvaluation), 10);
      });
    });
    it('runs in selected page', async () => {
      await withMcpContext(async (response, context) => {
        await evaluateScript().handler(
          {
            params: {function: String(() => document.title)},
          },
          response,
          context,
        );

        let lineEvaluation =
          response.responseLines.at(2) ??
          assert.fail('Missing serialized evaluation result');
        assert.strictEqual(JSON.parse(lineEvaluation), '');

        const page = await context.newPage();
        await page.pptrPage.setContent(`
          <head>
            <title>New Page</title>
          </head>
        `);

        response.resetResponseLineForTesting();
        await evaluateScript().handler(
          {
            params: {function: String(() => document.title)},
          },
          response,
          context,
        );

        lineEvaluation =
          response.responseLines.at(2) ??
          assert.fail('Missing serialized evaluation result');
        assert.strictEqual(JSON.parse(lineEvaluation), 'New Page');
      });
    });

    it('serializes nested arrays and objects', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        await page.setContent(html`<script defer></script>`);
        await page.evaluate(() => {
          const script = document.querySelector('script');
          if (!script) {
            throw new Error('Missing script fixture');
          }
          script.async = false;
        });

        await evaluateScript().handler(
          {
            params: {
              function: String(() => {
                const scripts = Array.from(
                  document.querySelectorAll('script'),
                ).map(s => ({src: s.src, async: s.async, defer: s.defer}));

                return {scripts};
              }),
            },
          },
          response,
          context,
        );
        const lineEvaluation =
          response.responseLines.at(2) ??
          assert.fail('Missing serialized evaluation result');
        assert.deepEqual(JSON.parse(lineEvaluation), {
          scripts: [{src: '', async: false, defer: true}],
        });
      });
    });

    it('isolates evaluation globals unless the main world is requested', async () => {
      await withMcpContext(async (response, context) => {
        await context.getSelectedPptrPage().evaluate(() => {
          Reflect.set(window, 'evaluationFixture', 'main-world');
        });
        await evaluateScript().handler(
          {params: {function: '() => typeof globalThis.evaluationFixture'}},
          response,
          context,
        );
        assert.strictEqual(
          JSON.parse(
            response.responseLines.at(2) ?? assert.fail('Missing result'),
          ),
          'undefined',
        );
        response.resetResponseLineForTesting();
        await evaluateScript().handler(
          {
            params: {
              function: '() => globalThis.evaluationFixture',
              world: 'main',
            },
          },
          response,
          context,
        );
        assert.strictEqual(
          JSON.parse(
            response.responseLines.at(2) ?? assert.fail('Missing result'),
          ),
          'main-world',
        );
      });
    });

    it('work for scripts that trigger dialogs', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        await page.setContent(html`<button id="test">test</button>`);

        await evaluateScript().handler(
          {
            params: {
              function: String(() => {
                alert('hello');
                return 'Works';
              }),
            },
          },
          response,
          context,
        );
        const lineEvaluation =
          response.responseLines.at(2) ??
          assert.fail('Missing serialized evaluation result');
        assert.strictEqual(JSON.parse(lineEvaluation), 'Works');
      });
    });

    it('work for scripts that trigger dialogs and dismiss them', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        await page.setContent(html`<button id="test">test</button>`);

        await evaluateScript().handler(
          {
            params: {
              function: String(() => {
                return confirm('hello');
              }),
              dialogAction: 'dismiss',
            },
          },
          response,
          context,
        );
        const lineEvaluation =
          response.responseLines.at(2) ??
          assert.fail('Missing serialized evaluation result');
        assert.strictEqual(JSON.parse(lineEvaluation), false);
      });
    });

    it('work for scripts that trigger prompts and fill them', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        await page.setContent(html`<button id="test">test</button>`);

        await evaluateScript().handler(
          {
            params: {
              function: String(() => {
                return prompt('Enter your name:');
              }),
              dialogAction: 'John Doe',
            },
          },
          response,
          context,
        );
        const lineEvaluation =
          response.responseLines.at(2) ??
          assert.fail('Missing serialized evaluation result');
        assert.strictEqual(JSON.parse(lineEvaluation), 'John Doe');
      });
    });

    it('work for async functions', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        await page.setContent(html`<script src="./scripts.js"></script> `);

        await evaluateScript().handler(
          {
            params: {
              function: String(async () => {
                await new Promise(res => setTimeout(res, 0));
                return 'Works';
              }),
            },
          },
          response,
          context,
        );
        const lineEvaluation =
          response.responseLines.at(2) ??
          assert.fail('Missing serialized evaluation result');
        assert.strictEqual(JSON.parse(lineEvaluation), 'Works');
      });
    });

    it('work with one argument', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        await page.setContent(html`<button id="test">test</button>`);

        context.getSelectedMcpPage().textSnapshot = await TextSnapshot.create(
          context.getSelectedMcpPage(),
        );

        await evaluateScript().handler(
          {
            params: {
              function: String(async (el: Element) => {
                return el.id;
              }),
              args: ['1_1'],
            },
          },
          response,
          context,
        );
        const lineEvaluation =
          response.responseLines.at(2) ??
          assert.fail('Missing serialized evaluation result');
        assert.strictEqual(JSON.parse(lineEvaluation), 'test');
      });
    });

    it('work with multiple args', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        await page.setContent(html`<button id="test">test</button>`);

        context.getSelectedMcpPage().textSnapshot = await TextSnapshot.create(
          context.getSelectedMcpPage(),
        );

        await evaluateScript().handler(
          {
            params: {
              function: String((container: Element, child: Element) => {
                return container.contains(child);
              }),
              args: ['1_0', '1_1'],
            },
          },
          response,
          context,
        );
        const lineEvaluation =
          response.responseLines.at(2) ??
          assert.fail('Missing serialized evaluation result');
        assert.strictEqual(JSON.parse(lineEvaluation), true);
      });
    });

    it('work for elements inside iframes', async () => {
      server.addHtmlRoute(
        '/iframe',
        html`<main><button>I am iframe button</button></main>`,
      );
      server.addHtmlRoute('/main', html`<iframe src="/iframe"></iframe>`);

      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        await page.goto(server.getRoute('/main'));
        context.getSelectedMcpPage().textSnapshot = await TextSnapshot.create(
          context.getSelectedMcpPage(),
        );
        await evaluateScript().handler(
          {
            params: {
              function: String((element: Element) => {
                return element.textContent;
              }),
              args: ['1_3'],
            },
          },
          response,
          context,
        );
        const lineEvaluation =
          response.responseLines.at(2) ??
          assert.fail('Missing serialized evaluation result');
        assert.strictEqual(JSON.parse(lineEvaluation), 'I am iframe button');
      });
    });
  });
});

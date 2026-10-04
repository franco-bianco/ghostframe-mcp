/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {zod} from '../../src/third_party/index.js';
import {emulate} from '../../src/tools/emulation.js';
import {serverHooks} from '../server.js';
import {html, withMcpContext} from '../utils.js';

describe('emulation', () => {
  const server = serverHooks();
  const schema = zod.object(emulate.schema);

  it('applies viewport syntax to dimensions, pixel ratio, touch and inherited pages', async () => {
    await withMcpContext(async (response, context) => {
      const page = context.getSelectedPptrPage();
      await page.goto(
        'data:text/html,<meta name="viewport" content="width=device-width">',
      );
      await emulate.handler(
        {
          params: schema.parse({viewport: '400x600x2,mobile,touch'}),
          page: context.getSelectedMcpPage(),
        },
        response,
        context,
      );
      assert.deepStrictEqual(
        await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          ratio: devicePixelRatio,
          touch: navigator.maxTouchPoints > 0,
        })),
        {width: 400, height: 600, ratio: 2, touch: true},
      );
      const inherited = await context.newPage();
      await inherited.pptrPage.setContent(
        html`<meta
          name="viewport"
          content="width=device-width"
        />`,
      );
      assert.strictEqual(
        await inherited.pptrPage.evaluate(() => innerWidth),
        400,
      );
      await emulate.handler({params: {}, page: inherited}, response, context);
      await inherited.pptrPage.waitForFunction(() => innerWidth !== 400);
    });
  });

  it('blocks fetches offline, scopes the override to its page and restores access', async () => {
    server.addHtmlRoute('/offline-page', html`<main>Network</main>`);
    server.addRoute('/offline-data', async (_req, res) => {
      res.end('online');
    });
    await withMcpContext(async (response, context) => {
      const original = context.getSelectedMcpPage();
      await original.pptrPage.goto(server.getRoute('/offline-page'));
      await emulate.handler(
        {params: schema.parse({networkConditions: 'Offline'}), page: original},
        response,
        context,
      );
      assert.strictEqual(
        await original.pptrPage.evaluate(() =>
          fetch('/offline-data').then(
            () => false,
            () => true,
          ),
        ),
        true,
      );
      const second = await context.newPage();
      await second.pptrPage.goto(server.getRoute('/offline-page'));
      assert.strictEqual(
        await second.pptrPage.evaluate(() =>
          fetch('/offline-data').then(res => res.text()),
        ),
        'online',
      );
      context.selectPage(original);
      await emulate.handler({params: {}, page: original}, response, context);
      assert.strictEqual(
        await original.pptrPage.evaluate(() =>
          fetch('/offline-data').then(res => res.text()),
        ),
        'online',
      );
    });
  });

  it('rejects unsupported network conditions and CPU rates at the public boundary', () => {
    assert.strictEqual(
      schema.safeParse({networkConditions: 'Slow 11G'}).success,
      false,
    );
    assert.strictEqual(schema.safeParse({cpuThrottlingRate: 0}).success, false);
    assert.strictEqual(
      schema.safeParse({cpuThrottlingRate: 21}).success,
      false,
    );
  });

  it('exposes location through navigator and carries it to a new page', async () => {
    server.addHtmlRoute('/location', html`<main>Location</main>`);
    await withMcpContext(async (response, context) => {
      const page = context.getSelectedPptrPage();
      await page
        .browserContext()
        .overridePermissions(server.baseUrl, ['geolocation']);
      await page.goto(server.getRoute('/location'));
      await emulate.handler(
        {
          params: schema.parse({geolocation: '48.137154x11.576124'}),
          page: context.getSelectedMcpPage(),
        },
        response,
        context,
      );
      const readLocation = async () =>
        context.getSelectedPptrPage().evaluate(
          () =>
            new Promise<{latitude: number; longitude: number}>(
              (resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                  position =>
                    resolve({
                      latitude: position.coords.latitude,
                      longitude: position.coords.longitude,
                    }),
                  error => reject(new Error(error.message)),
                  {timeout: 3000},
                );
              },
            ),
        );
      assert.deepStrictEqual(await readLocation(), {
        latitude: 48.137154,
        longitude: 11.576124,
      });
      const inherited = await context.newPage();
      await inherited.pptrPage.goto(server.getRoute('/location'));
      assert.deepStrictEqual(await readLocation(), {
        latitude: 48.137154,
        longitude: 11.576124,
      });
      await emulate.handler(
        {params: schema.parse({geolocation: '40x20'}), page: inherited},
        response,
        context,
      );
      assert.deepStrictEqual(await readLocation(), {
        latitude: 40,
        longitude: 20,
      });
    });
  });

  it('updates, carries and resets the browser-visible user agent', async () => {
    await withMcpContext(async (response, context) => {
      const original = context.getSelectedMcpPage();
      const baseline = await original.pptrPage.evaluate(
        () => navigator.userAgent,
      );
      for (const userAgent of ['UA1', 'UA2']) {
        await emulate.handler(
          {params: {userAgent}, page: original},
          response,
          context,
        );
        assert.strictEqual(
          await original.pptrPage.evaluate(() => navigator.userAgent),
          userAgent,
        );
      }
      const inherited = await context.newPage();
      assert.strictEqual(
        await inherited.pptrPage.evaluate(() => navigator.userAgent),
        'UA2',
      );
      await emulate.handler({params: {}, page: inherited}, response, context);
      assert.strictEqual(
        await inherited.pptrPage.evaluate(() => navigator.userAgent),
        baseline,
      );
    });
  });

  it('updates and resets the browser color preference', async () => {
    await withMcpContext(async (response, context) => {
      const page = context.getSelectedPptrPage();
      const baseline = await page.evaluate(
        () => matchMedia('(prefers-color-scheme: dark)').matches,
      );
      for (const colorScheme of ['dark', 'light']) {
        await emulate.handler(
          {
            params: schema.parse({colorScheme}),
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );
        assert.strictEqual(
          await page.evaluate(
            () => matchMedia('(prefers-color-scheme: dark)').matches,
          ),
          colorScheme === 'dark',
        );
      }
      await emulate.handler(
        {params: {colorScheme: 'auto'}, page: context.getSelectedMcpPage()},
        response,
        context,
      );
      assert.strictEqual(
        await page.evaluate(
          () => matchMedia('(prefers-color-scheme: dark)').matches,
        ),
        baseline,
      );
    });
  });
});

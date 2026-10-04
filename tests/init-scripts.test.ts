/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {getStealthInitScript} from '../src/init-scripts/index.js';

import {withBrowser} from './utils.js';

describe('init-scripts', () => {
  it('preserves native text for the toString shim', async () => {
    await withBrowser(async (_browser, page) => {
      await page.evaluateOnNewDocument(getStealthInitScript());
      await page.goto('about:blank');
      const result = await page.evaluate(() => {
        return Function.prototype.toString.call(Function.prototype.toString);
      });
      assert.strictEqual(result, 'function toString() { [native code] }');
    });
  });

  it('exposes the chrome.runtime compatibility object', async () => {
    await withBrowser(async (_browser, page) => {
      await page.evaluateOnNewDocument(getStealthInitScript());
      await page.goto('about:blank');
      const runtimeType = await page.evaluate(() => {
        const chrome = Reflect.get(window, 'chrome');
        return typeof Reflect.get(chrome, 'runtime');
      });
      assert.strictEqual(runtimeType, 'object');
    });
  });

  it('reconciles Notification.permission with the permissions query', async () => {
    await withBrowser(async (_browser, page) => {
      await page.evaluateOnNewDocument(getStealthInitScript());
      await page.goto('about:blank');
      const agrees = await page.evaluate(async () => {
        const status = await navigator.permissions.query({
          name: 'notifications',
        });
        return status.state === Notification.permission;
      });
      assert.strictEqual(agrees, true);
    });
  });

  it('anchors fallback csi() to the navigation while page time advances', async () => {
    await withBrowser(async (_browser, page) => {
      // Chrome still ships csi()/loadTimes(), so the shims only apply if it
      // ever stops. Delete them first to exercise our fallback.
      await page.evaluateOnNewDocument(`delete window.chrome;`);
      await page.evaluateOnNewDocument(getStealthInitScript());
      await page.goto('about:blank');
      const result = await page.evaluate(async () => {
        const chrome = Reflect.get(window, 'chrome');
        const csi: unknown = Reflect.get(chrome, 'csi');
        if (typeof csi !== 'function') {
          throw new Error('Missing csi fallback');
        }
        const before: unknown = csi();
        await new Promise(requestAnimationFrame);
        const after: unknown = csi();
        if (
          !before ||
          typeof before !== 'object' ||
          !after ||
          typeof after !== 'object' ||
          !('startE' in before) ||
          !('startE' in after) ||
          !('pageT' in before) ||
          typeof before.pageT !== 'number' ||
          !('pageT' in after) ||
          typeof after.pageT !== 'number'
        ) {
          throw new Error('Invalid csi timing data');
        }
        return {
          beforeStart: before.startE,
          afterStart: after.startE,
          timeOrigin: Math.floor(performance.timeOrigin),
          beforePageTime: before.pageT,
          afterPageTime: after.pageT,
        };
      });
      assert.strictEqual(result.beforeStart, result.timeOrigin);
      assert.strictEqual(result.afterStart, result.timeOrigin);
      assert.ok(result.afterPageTime > result.beforePageTime);
    });
  });
});

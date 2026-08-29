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
  it('keeps the toString shim indistinguishable from the native one', async () => {
    await withBrowser(async (_browser, page) => {
      await page.evaluateOnNewDocument(getStealthInitScript());
      await page.goto('about:blank');
      const result = await page.evaluate(() => {
        return Function.prototype.toString.call(Function.prototype.toString);
      });
      assert.strictEqual(result, 'function toString() { [native code] }');
    });
  });

  it('installs chrome.runtime, which Chrome omits on ordinary pages', async () => {
    await withBrowser(async (_browser, page) => {
      await page.evaluateOnNewDocument(getStealthInitScript());
      await page.goto('about:blank');
      const runtimeType = await page.evaluate(() => {
        return typeof (window as unknown as {chrome?: {runtime?: unknown}})
          .chrome?.runtime;
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
          name: 'notifications' as PermissionName,
        });
        return status.state === Notification.permission;
      });
      assert.strictEqual(agrees, true);
    });
  });

  it('freezes csi() when Chrome does not provide it', async () => {
    await withBrowser(async (_browser, page) => {
      // Chrome still ships csi()/loadTimes(), so the shims only apply if it
      // ever stops. Delete them first to exercise our fallback.
      await page.evaluateOnNewDocument(`delete window.chrome;`);
      await page.evaluateOnNewDocument(getStealthInitScript());
      await page.goto('about:blank');
      const result = await page.evaluate(() => {
        const chrome = (
          window as unknown as {chrome: {csi(): {startE: number}}}
        ).chrome;
        return chrome.csi().startE === chrome.csi().startE;
      });
      assert.strictEqual(result, true);
    });
  });
});

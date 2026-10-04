/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {setTimeout} from 'node:timers/promises';
import {gzipSync} from 'node:zlib';

import {InterceptionController} from '../../src/investigation/InterceptionController.js';
import {OperationManager} from '../../src/investigation/OperationManager.js';
import {serverHooks} from '../server.js';
import {withBrowser} from '../utils.js';

describe('live request interception', () => {
  const server = serverHooks();

  async function waitForPause(controller: InterceptionController, id: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = controller.get(id);
      if (state.status === 'paused') {
        return state;
      }
      await setTimeout(10);
    }
    throw new Error('Request did not pause.');
  }

  async function waitForBody(controller: InterceptionController, id: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const body = controller.body(id);
      if (body.status === 'complete' || body.status === 'truncated') {
        return body;
      }
      if (body.status === 'failed') {
        throw new Error(body.error);
      }
      await setTimeout(10);
    }
    throw new Error('Body did not complete.');
  }

  it('mutates the original request while an operation remains readable', async () => {
    server.addHtmlRoute('/page', '<main>test</main>');
    let receivedMethod: string | undefined;
    let receivedHeader: string | string[] | undefined;
    let receivedBody = '';
    server.addRoute('/api', (req, res) => {
      receivedMethod = req.method;
      receivedHeader = req.headers['x-signature'];
      req.on('data', chunk => {
        receivedBody += String(chunk);
      });
      req.on('end', () => {
        res.end('accepted');
      });
    });
    await withBrowser(async (_browser, page) => {
      const controller = new InterceptionController();
      const operations = new OperationManager();
      try {
        await page.goto(server.getRoute('/page'));
        const rule = await controller.arm(page, {
          urlPattern: server.getRoute('/api'),
          method: 'POST',
        });
        const operation = operations.start(
          page,
          'fetch',
          () =>
            page.evaluate(async () =>
              fetch('/api', {
                method: 'POST',
                body: 'original',
                headers: {Authorization: 'Bearer original-token'},
              }).then(r => r.text()),
            ),
          async () => undefined,
        );
        const paused = await waitForPause(controller, rule.interceptionId);
        assert.equal(paused.request?.postData, 'original');
        assert.ok(
          paused.request?.headers?.some(
            header =>
              header.name.toLowerCase() === 'authorization' &&
              header.value === 'Bearer original-token',
          ),
        );
        assert.equal(operations.get(operation.operationId).status, 'running');
        await controller.resolve(rule.interceptionId, {
          action: 'continue',
          method: 'PUT',
          postData: 'changed',
          headers: ['Content-Type: text/plain', 'X-Signature: live-signature'],
        });
        for (
          let attempt = 0;
          attempt < 100 &&
          operations.get(operation.operationId).executionMayContinue;
          attempt++
        ) {
          await setTimeout(10);
        }
        assert.equal(operations.get(operation.operationId).result, 'accepted');
        assert.equal(receivedMethod, 'PUT');
        assert.equal(receivedBody, 'changed');
        assert.equal(receivedHeader, 'live-signature');
      } finally {
        await operations.dispose();
        await controller.dispose();
      }
    });
  });

  it('reads and replaces the actual server response before page delivery', async () => {
    server.addHtmlRoute('/response-page', '<main>test</main>');
    let requestCount = 0;
    server.addRoute('/response-api', (_req, res) => {
      requestCount++;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Source', 'server');
      res.setHeader('X-Api-Key', 'complete-response-token');
      res.setHeader('Set-Cookie', 'response-token=original; HttpOnly');
      res.end('{"value":"original"}');
    });
    await withBrowser(async (_browser, page) => {
      const controller = new InterceptionController();
      try {
        await page.goto(server.getRoute('/response-page'));
        const rule = await controller.arm(page, {
          urlPattern: server.getRoute('/response-api'),
          stage: 'response',
        });
        const pendingFetch = page.evaluate(async () =>
          fetch('/response-api').then(async r => ({
            status: r.status,
            source: r.headers.get('x-source'),
            body: await r.json(),
          })),
        );
        const paused = await waitForPause(controller, rule.interceptionId);
        assert.equal(paused.response?.status, 200);
        assert.equal(
          paused.response?.headers?.find(
            header => header.name.toLowerCase() === 'x-api-key',
          )?.value,
          'complete-response-token',
        );
        assert.equal(controller.body(rule.interceptionId).status, 'reading');
        const body = await waitForBody(controller, rule.interceptionId);
        assert.equal(body.status, 'complete');
        assert.ok(body.body);
        assert.equal(
          Buffer.from(body.body, 'base64').toString(),
          '{"value":"original"}',
        );
        await controller.resolve(rule.interceptionId, {
          action: 'fulfill',
          status: 201,
          body: '{"value":"replaced"}',
        });
        assert.deepEqual(await pendingFetch, {
          status: 201,
          source: 'server',
          body: {value: 'replaced'},
        });
        assert.equal(requestCount, 1);
        assert.ok(
          (await page.browserContext().cookies()).some(
            cookie =>
              cookie.name === 'response-token' &&
              cookie.value === 'original' &&
              cookie.httpOnly,
          ),
        );
      } finally {
        await controller.dispose();
      }
    });
  });

  it('reconstructs a complete consumed compressed response on explicit continue', async () => {
    server.addHtmlRoute('/consumed-page', '<main>test</main>');
    const original = 'complete original response';
    const compressed = gzipSync(original);
    server.addRoute('/consumed-api', (_req, res) => {
      res.statusMessage = 'Original phrase';
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', compressed.length);
      res.setHeader('X-Source', 'original');
      res.end(compressed);
    });
    await withBrowser(async (_browser, page) => {
      const controller = new InterceptionController();
      try {
        await page.goto(server.getRoute('/consumed-page'));
        const rule = await controller.arm(page, {
          urlPattern: server.getRoute('/consumed-api'),
          stage: 'response',
        });
        const pendingFetch = page.evaluate(async () => {
          const response = await fetch('/consumed-api');
          return {
            body: await response.text(),
            source: response.headers.get('x-source'),
            statusText: response.statusText,
          };
        });
        await waitForPause(controller, rule.interceptionId);
        const body = await waitForBody(controller, rule.interceptionId);
        assert.equal(body.status, 'complete');
        assert.ok(body.body);
        assert.equal(Buffer.from(body.body, 'base64').toString(), original);
        const resolved = await controller.resolve(rule.interceptionId, {
          action: 'continue',
        });
        assert.equal(resolved.releaseAction, 'fulfilled');
        assert.deepEqual(await pendingFetch, {
          body: original,
          source: 'original',
          statusText: 'Original phrase',
        });
      } finally {
        await controller.dispose();
      }
    });
  });

  it('returns pending reads promptly and cancels a stalled consumed response without waiting for IO.read', async () => {
    server.addHtmlRoute('/stalled-page', '<main>test</main>');
    let requestCount = 0;
    server.addRoute('/stalled-api', (_req, res) => {
      requestCount++;
      res.setHeader('Content-Type', 'text/plain');
      res.write('x'.repeat(65536));
      // Leave the response open so the next read waits for bytes indefinitely.
    });
    await withBrowser(async (_browser, page) => {
      const controller = new InterceptionController();
      try {
        await page.goto(server.getRoute('/stalled-page'));
        const rule = await controller.arm(page, {
          urlPattern: server.getRoute('/stalled-api'),
          stage: 'response',
        });
        const pendingFetch = page.evaluate(async () => {
          try {
            await fetch('/stalled-api').then(response => response.text());
            return {failed: false};
          } catch {
            return {failed: true};
          }
        });
        await waitForPause(controller, rule.interceptionId);
        const before = Date.now();
        const body = controller.body(rule.interceptionId, 131072);
        assert.equal(body.status, 'reading');
        assert.ok(Date.now() - before < 500);
        for (let attempt = 0; attempt < 100; attempt++) {
          if (controller.body(rule.interceptionId).bytesRead > 0) {
            break;
          }
          await setTimeout(10);
        }
        assert.ok(controller.body(rule.interceptionId).bytesRead > 0);
        const cancelled = await Promise.race([
          controller.cancel(rule.interceptionId),
          setTimeout(2000).then(() => {
            throw new Error('Cancellation waited for a stalled body read.');
          }),
        ]);
        assert.equal(cancelled.status, 'cancelled');
        assert.equal(cancelled.releaseAction, 'aborted');
        assert.equal(controller.isActive(page), false);
        assert.deepEqual(await pendingFetch, {failed: true});
        assert.equal(await page.evaluate(() => 42), 42);
        assert.equal(requestCount, 1);
      } finally {
        await controller.dispose();
      }
    });
  });

  it('orders cancellation after stream acquisition when it starts before the stream handle returns', async () => {
    server.addHtmlRoute('/acquiring-page', '<main>test</main>');
    server.addRoute('/acquiring-api', (_req, res) => {
      res.write('stalled');
    });
    await withBrowser(async (_browser, page) => {
      const controller = new InterceptionController();
      try {
        await page.goto(server.getRoute('/acquiring-page'));
        const rule = await controller.arm(page, {
          urlPattern: server.getRoute('/acquiring-api'),
          stage: 'response',
        });
        const pendingFetch = page.evaluate(async () => {
          try {
            await fetch('/acquiring-api').then(response => response.text());
            return false;
          } catch {
            return true;
          }
        });
        await waitForPause(controller, rule.interceptionId);
        assert.equal(controller.body(rule.interceptionId).status, 'reading');
        // No yield: acquisition cannot finish before cancellation starts.
        const cancelled = await Promise.race([
          controller.cancel(rule.interceptionId),
          setTimeout(2000).then(() => {
            throw new Error('Cancellation stalled during acquisition.');
          }),
        ]);
        assert.equal(cancelled.releaseAction, 'aborted');
        assert.equal(await pendingFetch, true);
      } finally {
        await controller.dispose();
      }
    });
  });

  it('aborts an incomplete consumed response at its deadline', async () => {
    server.addHtmlRoute('/body-timeout-page', '<main>test</main>');
    server.addRoute('/body-timeout-api', (_req, res) => {
      res.write('never complete');
    });
    await withBrowser(async (_browser, page) => {
      const controller = new InterceptionController();
      try {
        await page.goto(server.getRoute('/body-timeout-page'));
        const rule = await controller.arm(page, {
          urlPattern: server.getRoute('/body-timeout-api'),
          stage: 'response',
          timeout: 500,
        });
        const pendingFetch = page.evaluate(async () => {
          try {
            await fetch('/body-timeout-api').then(response => response.text());
            return false;
          } catch {
            return true;
          }
        });
        await waitForPause(controller, rule.interceptionId);
        assert.equal(controller.body(rule.interceptionId).status, 'reading');
        assert.equal(await pendingFetch, true);
        const released = controller.get(rule.interceptionId);
        assert.equal(released.status, 'timed_out');
        assert.equal(released.releaseAction, 'aborted');
        assert.equal(controller.isActive(page), false);
      } finally {
        await controller.dispose();
      }
    });
  });

  it('retains only the byte limit and requires replacement or abort for an over-limit consumed response', async () => {
    server.addHtmlRoute('/bounded-page', '<main>test</main>');
    server.addRoute('/bounded-api', (_req, res) => {
      res.end('x'.repeat(65536));
    });
    await withBrowser(async (_browser, page) => {
      const controller = new InterceptionController();
      try {
        await page.goto(server.getRoute('/bounded-page'));
        const rule = await controller.arm(page, {
          urlPattern: server.getRoute('/bounded-api'),
          stage: 'response',
        });
        const pendingFetch = page.evaluate(async () =>
          fetch('/bounded-api').then(response => response.text()),
        );
        await waitForPause(controller, rule.interceptionId);
        controller.body(rule.interceptionId, 8);
        const body = await waitForBody(controller, rule.interceptionId);
        assert.equal(body.status, 'truncated');
        assert.ok(body.body);
        assert.equal(Buffer.from(body.body, 'base64').length, 8);
        assert.equal(body.bytesRead, 9);
        assert.equal(body.totalBytes, undefined);
        await assert.rejects(
          controller.resolve(rule.interceptionId, {action: 'continue'}),
          /complete body/,
        );
        await controller.resolve(rule.interceptionId, {
          action: 'fulfill',
          body: 'replacement',
        });
        assert.equal(await pendingFetch, 'replacement');
      } finally {
        await controller.dispose();
      }
    });
  });

  it('continues unchanged traffic when a pause deadline expires', async () => {
    server.addHtmlRoute('/timeout-page', '<main>test</main>');
    server.addRoute('/timeout-api', (_req, res) => {
      res.end('unchanged');
    });
    await withBrowser(async (_browser, page) => {
      const controller = new InterceptionController();
      try {
        await page.goto(server.getRoute('/timeout-page'));
        const rule = await controller.arm(page, {
          urlPattern: server.getRoute('/timeout-api'),
          timeout: 100,
        });
        const pendingFetch = page.evaluate(async () =>
          fetch('/timeout-api').then(r => r.text()),
        );
        await waitForPause(controller, rule.interceptionId);
        assert.equal(await pendingFetch, 'unchanged');
        assert.equal(controller.get(rule.interceptionId).status, 'timed_out');
        assert.equal(controller.isActive(page), false);
      } finally {
        await controller.dispose();
      }
    });
  });

  it('rejects conflicting rules and releases a request on cancellation', async () => {
    server.addHtmlRoute('/cancel-page', '<main>test</main>');
    server.addRoute('/cancel-api', (_req, res) => {
      res.end('released');
    });
    await withBrowser(async (_browser, page) => {
      const controller = new InterceptionController();
      try {
        await page.goto(server.getRoute('/cancel-page'));
        const rule = await controller.arm(page, {
          urlPattern: server.getRoute('/cancel-api'),
        });
        await assert.rejects(
          controller.arm(page, {urlPattern: '*'}),
          /Only one/,
        );
        assert.throws(
          () => controller.assertNavigationAllowed(page, '*'),
          /allowList/,
        );
        const pendingFetch = page.evaluate(async () =>
          fetch('/cancel-api').then(r => r.text()),
        );
        await waitForPause(controller, rule.interceptionId);
        await controller.cancel(rule.interceptionId);
        assert.equal(await pendingFetch, 'released');
        assert.equal(controller.get(rule.interceptionId).status, 'cancelled');
      } finally {
        await controller.dispose();
      }
    });
  });
});

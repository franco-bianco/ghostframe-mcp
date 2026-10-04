/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {
  getNetworkRequest,
  listNetworkRequests,
  setBlockedUrls,
} from '../../src/tools/network.js';
import {serverHooks} from '../server.js';
import {
  getTextContent,
  html,
  stabilizeResponseOutput,
  withMcpContext,
} from '../utils.js';

describe('network', () => {
  const server = serverHooks();
  describe('set_blocked_urls', () => {
    it('persists across navigation and can be cleared', async () => {
      let requestCount = 0;
      server.addHtmlRoute('/block-page', html`<main>block test</main>`);
      server.addRoute('/blocked-resource', async (_req, res) => {
        requestCount++;
        res.end('loaded');
      });

      await withMcpContext(async (response, context) => {
        const mcpPage = context.getSelectedMcpPage();
        const page = mcpPage.pptrPage;
        await setBlockedUrls.handler(
          {
            params: {patterns: [`${server.getRoute('/blocked-resource')}*`]},
            page: mcpPage,
          },
          response,
          context,
        );
        await page.goto(server.getRoute('/block-page'));
        const blocked = await page.evaluate(async () => {
          return fetch('/blocked-resource').then(
            () => false,
            () => true,
          );
        });
        assert.strictEqual(blocked, true);
        assert.strictEqual(requestCount, 0);

        await setBlockedUrls.handler(
          {params: {patterns: []}, page: mcpPage},
          response,
          context,
        );
        const body = await page.evaluate(async () => {
          return fetch('/blocked-resource').then(result => result.text());
        });
        assert.strictEqual(body, 'loaded');
        assert.strictEqual(requestCount, 1);
      });
    });
  });

  describe('network_list_requests', () => {
    it('list requests from current navigations only', async t => {
      server.addHtmlRoute('/one', html`<main>First</main>`);
      server.addHtmlRoute('/two', html`<main>Second</main>`);
      server.addHtmlRoute('/three', html`<main>Third</main>`);

      await withMcpContext(async (response, context) => {
        await context.setUpNetworkCollectorForTesting();
        const page = context.getSelectedPptrPage();
        await page.goto(server.getRoute('/one'));
        await page.goto(server.getRoute('/two'));
        await page.goto(server.getRoute('/three'));
        await listNetworkRequests.handler(
          {
            params: {},

            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );
        const responseData = await response.handle('list_request', context);
        t.assert.snapshot?.(
          stabilizeResponseOutput(getTextContent(responseData.content[0])),
        );
      });
    });

    it('list requests from previous navigations', async t => {
      server.addHtmlRoute('/one', html`<main>First</main>`);
      server.addHtmlRoute('/two', html`<main>Second</main>`);
      server.addHtmlRoute('/three', html`<main>Third</main>`);

      await withMcpContext(async (response, context) => {
        await context.setUpNetworkCollectorForTesting();
        const page = context.getSelectedPptrPage();
        await page.goto(server.getRoute('/one'));
        await page.goto(server.getRoute('/two'));
        await page.goto(server.getRoute('/three'));
        await listNetworkRequests.handler(
          {
            params: {
              includePreservedRequests: true,
            },
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );
        const responseData = await response.handle('list_request', context);
        t.assert.snapshot?.(
          stabilizeResponseOutput(getTextContent(responseData.content[0])),
        );
      });
    });

    it('list requests from previous navigations from redirects', async t => {
      server.addRoute('/redirect', async (_req, res) => {
        res.writeHead(302, {
          Location: server.getRoute('/redirected'),
        });
        res.end();
      });

      server.addHtmlRoute(
        '/redirected',
        html`<script>
          document.location.href = '/redirected-page';
        </script>`,
      );

      server.addHtmlRoute(
        '/redirected-page',
        html`<main>I was redirected 2 times</main>`,
      );

      await withMcpContext(async (response, context) => {
        await context.setUpNetworkCollectorForTesting();
        const page = context.getSelectedPptrPage();
        await page.goto(server.getRoute('/redirect'), {
          waitUntil: 'networkidle0',
        });
        await listNetworkRequests.handler(
          {
            params: {
              includePreservedRequests: true,
            },
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );
        const responseData = await response.handle('list_request', context);
        t.assert.snapshot?.(
          stabilizeResponseOutput(getTextContent(responseData.content[0])),
        );
      });
    });
  });
  describe('network_get_request', () => {
    it('returns the captured method, headers and bodies for a POST request', async () => {
      server.addHtmlRoute('/post-page', html`<main>API</main>`);
      server.addRoute('/post-api', (req, res) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => {
          body += chunk;
        });
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-Response-Evidence', 'received');
          res.end(JSON.stringify({received: body}));
        });
      });
      await withMcpContext(async (response, context) => {
        await context.setUpNetworkCollectorForTesting();
        const page = context.getSelectedPptrPage();
        await page.goto(server.getRoute('/post-page'));
        const received = page.waitForResponse(item =>
          item.url().endsWith('/post-api'),
        );
        await page.evaluate(async () => {
          await fetch('/post-api', {
            method: 'POST',
            headers: {'X-Request-Evidence': 'sent'},
            body: 'payload=123',
          }).then(res => res.text());
        });
        assert.strictEqual(
          await (await received).text(),
          '{"received":"payload=123"}',
        );
        const request = context
          .getNetworkRequests(context.getSelectedMcpPage())
          .find(item => item.url().endsWith('/post-api'));
        assert.ok(request);
        const reqid = context.getNetworkRequestStableId(request);
        assert.ok(typeof reqid === 'number');
        await getNetworkRequest.handler(
          {params: {reqid}, page: context.getSelectedMcpPage()},
          response,
          context,
        );
        const result = await response.handle('get_network_request', context);
        assert.strictEqual(
          'networkRequests' in result.structuredContent,
          false,
        );
        assert.ok('networkRequest' in result.structuredContent);
        const detail: unknown = result.structuredContent.networkRequest;
        assert.ok(detail && typeof detail === 'object');
        assert.ok('method' in detail && detail.method === 'POST');
        assert.ok(
          'url' in detail && detail.url === server.getRoute('/post-api'),
        );
        assert.ok(
          'requestBody' in detail && detail.requestBody === 'payload=123',
        );
        assert.ok('responseBody' in detail);
        assert.strictEqual(detail.responseBody, '{"received":"payload=123"}');
        assert.ok(
          'requestHeaders' in detail &&
            JSON.stringify(detail.requestHeaders).includes('sent'),
        );
        assert.ok(
          'responseHeaders' in detail &&
            JSON.stringify(detail.responseHeaders).includes('received'),
        );
      });
    });

    it('retains identifiable request metadata after subsequent navigations', async () => {
      server.addHtmlRoute('/one', html`<main>First</main>`);
      server.addHtmlRoute('/two', html`<main>Second</main>`);
      server.addHtmlRoute('/three', html`<main>Third</main>`);

      await withMcpContext(async (response, context) => {
        await context.setUpNetworkCollectorForTesting();
        const page = context.getSelectedPptrPage();
        await page.goto(server.getRoute('/one'));
        await page.goto(server.getRoute('/two'));
        await page.goto(server.getRoute('/three'));
        await getNetworkRequest.handler(
          {
            params: {
              reqid: 1,
            },
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );
        const responseData = await response.handle('get_request', context);
        assert.ok('networkRequest' in responseData.structuredContent);
        const detail: unknown = responseData.structuredContent.networkRequest;
        assert.ok(detail && typeof detail === 'object');
        assert.ok('url' in detail && detail.url === server.getRoute('/one'));
        assert.ok('method' in detail && detail.method === 'GET');
        assert.ok('status' in detail && detail.status === '200');
      });
    });
  });
});

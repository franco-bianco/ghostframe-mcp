/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, it} from 'node:test';
import {pathToFileURL} from 'node:url';

import sinon from 'sinon';

import {TextSnapshot} from '../src/TextSnapshot.js';

import {serverHooks} from './server.js';
import {getMockRequest, html, withMcpContext} from './utils.js';

describe('McpContext', () => {
  const server = serverHooks();
  afterEach(() => {
    sinon.restore();
  });

  it('resolves an existing element UID after a refreshed snapshot', async () => {
    await withMcpContext(async (_response, context) => {
      const page = context.getSelectedMcpPage();
      await page.pptrPage.setContent(html`<button>Click me</button>`);
      page.textSnapshot = await TextSnapshot.create(page);
      const first = await page.getElementByUid('1_1');
      assert.equal(
        await first.evaluate(element => element.textContent),
        'Click me',
      );
      await first.dispose();
      page.textSnapshot = await TextSnapshot.create(page);
      const refreshed = await page.getElementByUid('1_1');
      assert.equal(
        await refreshed.evaluate(element => element.textContent),
        'Click me',
      );
      await refreshed.dispose();
    });
  });

  it('should update default timeout when cpu throttling changes', async () => {
    await withMcpContext(async (_response, context) => {
      const page = await context.newPage();
      const timeoutBefore = page.pptrPage.getDefaultTimeout();
      await context.emulate({cpuThrottlingRate: 2});
      const timeoutAfter = page.pptrPage.getDefaultTimeout();
      assert(timeoutBefore < timeoutAfter, 'Timeout was less then expected');
    });
  });

  it('should update default timeout when network conditions changes', async () => {
    await withMcpContext(async (_response, context) => {
      const page = await context.newPage();
      const timeoutBefore = page.pptrPage.getDefaultNavigationTimeout();
      await context.emulate({networkConditions: 'Slow 3G'});
      const timeoutAfter = page.pptrPage.getDefaultNavigationTimeout();
      assert(timeoutBefore < timeoutAfter, 'Timeout was less then expected');
    });
  });

  it('should should detect open DevTools pages', async () => {
    await withMcpContext(
      async (_response, context) => {
        const page = await context.newPage();
        await context.createPagesSnapshot();
        assert.ok(page.devToolsPage);
      },
      {
        autoOpenDevTools: true,
      },
    );
  });

  it('keeps stealth enabled for newly created pages', async () => {
    await withMcpContext(
      async (_response, context) => {
        const page = await context.newPage();
        await page.pptrPage.goto('data:text/html,<title>stealth</title>');
        await page.pptrPage.evaluate(() => {
          console.log('collected under stealth');
        });

        // Console capture rides the primary session, where Runtime is already
        // enabled, so stealth does not suppress it.
        const consoleData = context.getConsoleData(page);
        assert.ok(
          consoleData.some(
            entry =>
              'text' in entry &&
              typeof entry.text === 'function' &&
              entry.text().includes('collected under stealth'),
          ),
          'expected the console message to be collected',
        );
        const result = await page.pptrPage.evaluate(() => {
          const webglGetParameter =
            WebGLRenderingContext.prototype.getParameter;
          return {
            chromeRuntime:
              window.chrome !== undefined && 'runtime' in window.chrome,
            marker: Object.hasOwn(
              navigator.permissions.query,
              Symbol.for('__cdtmcp_native__'),
            ),
            webglMarker: Object.hasOwn(
              webglGetParameter,
              Symbol.for('__cdtmcp_native__'),
            ),
            webglNative: webglGetParameter.toString().includes('[native code]'),
          };
        });

        assert.deepStrictEqual(result, {
          chromeRuntime: true,
          marker: false,
          webglMarker: false,
          webglNative: true,
        });
      },
      {stealth: true},
    );
  });
  it('resolves uid from a non-selected page snapshot', async () => {
    await withMcpContext(async (_response, context) => {
      // Page 1: set content and snapshot
      const page1 = context.getSelectedMcpPage();
      await page1.pptrPage.setContent(html`<button>Page1 Button</button>`);
      page1.textSnapshot = await TextSnapshot.create(page1, {
        verbose: false,
      });

      // Capture a uid from page1's snapshot (snapshotId=1, button is node 1)
      const page1Uid = '1_1';
      const page1Node = context.getAXNodeByUid(page1Uid);
      assert.ok(page1Node, 'uid should resolve from page1 snapshot');

      // Page 2: new page, set content, snapshot
      const page2 = await context.newPage();
      context.selectPage(page2);
      await page2.pptrPage.setContent(html`<button>Page2 Button</button>`);
      page2.textSnapshot = await TextSnapshot.create(page2, {
        verbose: false,
      });

      // Page 2 is now selected. Page 1's uid should still resolve.
      const node = context.getAXNodeByUid(page1Uid);
      assert.ok(node, 'page1 uid should still resolve after page2 snapshot');
      assert.strictEqual(node?.name, 'Page1 Button');

      // The element should also be retrievable when the target page is provided.
      const element = await page1.getElementByUid(page1Uid);
      assert.ok(element, 'should get element handle from page1 snapshot uid');
    });
  });

  it('serializes request identity and status in structured content', async () => {
    await withMcpContext(async (response, context) => {
      const request = getMockRequest({
        url: 'http://example.com/api',
        stableId: 123,
      });
      sinon.stub(context, 'getNetworkRequests').returns([request]);
      response.setIncludeNetworkRequests(true);
      const result = await response.handle('test', context);
      assert.ok('networkRequests' in result.structuredContent);
      assert.deepEqual(result.structuredContent.networkRequests, [
        {
          requestId: 123,
          method: 'GET',
          url: 'http://example.com/api',
          status: 'pending',
          selectedInDevToolsUI: false,
        },
      ]);
    });
  });

  it('serializes an attached request with complete header values', async () => {
    await withMcpContext(async (response, context) => {
      const request = getMockRequest({
        url: 'http://example.com/detail',
        stableId: 456,
        headers: {
          authorization: 'Bearer secret',
          'content-type': 'application/json',
        },
      });
      sinon.stub(context, 'getNetworkRequestById').returns(request);
      response.attachNetworkRequest(456);
      const result = await response.handle('test', context);
      assert.ok('networkRequest' in result.structuredContent);
      assert.deepEqual(
        JSON.parse(JSON.stringify(result.structuredContent.networkRequest)),
        {
          requestId: 456,
          method: 'GET',
          url: 'http://example.com/detail',
          status: 'pending',
          requestHeaders: {
            authorization: 'Bearer secret',
            'content-type': 'application/json',
          },
        },
      );
      assert.match(JSON.stringify(result), /Bearer secret/);
    });
  });

  it('saves actual browser request and response bodies and returns their file paths', async t => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ghostframe-response-files-'),
    );
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    server.addHtmlRoute('/file-page', '<main>body files</main>');
    server.addRoute('/file-api', (_request, response) => {
      response.setHeader('content-type', 'text/plain');
      response.end('actual response body');
    });
    await withMcpContext(async (response, context) => {
      const page = context.getSelectedMcpPage();
      await page.pptrPage.goto(server.getRoute('/file-page'));
      await page.pptrPage.evaluate(async () => {
        await fetch('/file-api', {
          method: 'POST',
          body: 'actual request body',
        }).then(result => result.text());
      });
      const request = context
        .getNetworkRequests(page)
        .find(request => request.url() === server.getRoute('/file-api'));
      assert.ok(request);
      const requestId = context.getNetworkRequestStableId(request);
      const requestFilePath = path.join(directory, 'request.network-request');
      const responseFilePath = path.join(
        directory,
        'response.network-response',
      );
      response.attachNetworkRequest(requestId, {
        requestFilePath,
        responseFilePath,
      });
      const result = await response.handle('test', context);
      assert.ok('networkRequest' in result.structuredContent);
      const details = result.structuredContent.networkRequest;
      assert.ok(typeof details === 'object' && details !== null);
      assert.ok(
        'requestBodyFilePath' in details && 'responseBodyFilePath' in details,
      );
      assert.equal(details.requestBodyFilePath, requestFilePath);
      assert.equal(details.responseBodyFilePath, responseFilePath);
      assert.ok(
        !('requestBody' in details) || details.requestBody === undefined,
      );
      assert.ok(
        !('responseBody' in details) || details.responseBody === undefined,
      );
      assert.equal(
        await fs.readFile(requestFilePath, 'utf8'),
        'actual request body',
      );
      assert.equal(
        await fs.readFile(responseFilePath, 'utf8'),
        'actual response body',
      );
    });
  });

  it('validatePath allows paths within roots', async () => {
    await withMcpContext(async (_response, context) => {
      const workspacePath = path.resolve(os.homedir(), 'workspace-test');
      const roots = [
        {uri: pathToFileURL(workspacePath).href, name: 'workspace'},
      ];
      context.setRoots(roots);
      // Valid path within root
      await context.validatePath(path.join(workspacePath, 'test.txt'));
      await context.validatePath(workspacePath);

      // Invalid path outside root and outside temp dir
      const outsidePath = path.resolve(os.homedir(), 'outside-test.txt');
      await assert.rejects(context.validatePath(outsidePath), /Access denied/);
    });
  });

  it('validatePath uses the temporary directory when roots are undefined', async () => {
    await withMcpContext(async (_response, context) => {
      context.setRoots(undefined);
      await context.validatePath(path.join(os.tmpdir(), 'test.txt'));
      await assert.rejects(
        context.validatePath(path.resolve(os.homedir(), 'anywhere.txt')),
        /Access denied/,
      );
    });
  });

  it('validatePath supports explicit unrestricted compatibility', async () => {
    await withMcpContext(
      async (_response, context) => {
        context.setRoots(undefined);
        await context.validatePath(path.resolve(os.homedir(), 'anywhere.txt'));
      },
      {allowUnrestrictedPaths: true},
    );
  });

  it('validatePath denies paths outside os.tmpdir() if roots list is empty', async () => {
    await withMcpContext(async (_response, context) => {
      context.setRoots([]);
      // Should allow temp dir
      await context.validatePath(path.join(os.tmpdir(), 'test.txt'));

      // Should deny outside temp dir
      await assert.rejects(
        context.validatePath(path.resolve(os.homedir(), 'anywhere.txt')),
        /Access denied/,
      );
    });
  });

  it('validatePath rejects symlinks that escape a root', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ghostframe-root-'));
    const outside = await fs.mkdtemp(
      path.join(process.cwd(), '.ghostframe-outside-'),
    );
    t.after(async () => {
      await fs.rm(root, {recursive: true, force: true});
      await fs.rm(outside, {recursive: true, force: true});
    });
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
    await fs.symlink(outside, path.join(root, 'escape'));

    await withMcpContext(async (_response, context) => {
      context.setRoots([{uri: pathToFileURL(root).href, name: 'workspace'}]);
      await assert.rejects(
        context.validatePath(path.join(root, 'escape', 'secret.txt')),
        /Access denied/,
      );
    });
  });
});

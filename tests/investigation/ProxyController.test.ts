/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {Server} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {executablePath} from 'puppeteer';

import {launch} from '../../src/browser.js';
import {ProxyController} from '../../src/investigation/ProxyController.js';

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return address.port;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve())),
  );
}

describe('ProxyController', () => {
  it('removes a previous session controller before reusing a persistent profile', async () => {
    const profile = await mkdtemp(
      path.join(os.tmpdir(), 'ghostframe-proxy-test-profile-'),
    );
    const proxy = createServer((_request, response) =>
      response.end('old route'),
    );
    const origin = createServer((_request, response) =>
      response.end('direct route'),
    );
    const proxyPort = await listen(proxy);
    const originPort = await listen(origin);
    const options = {
      headless: true,
      isolated: false,
      userDataDir: profile,
      executablePath: executablePath(),
      chromeArgs: [
        '--host-resolver-rules=MAP ghostframe-restart.test 127.0.0.1',
      ],
    };
    const first = await launch(options);
    const controller = new ProxyController(first);
    try {
      await controller.set({mode: 'proxy', server: `127.0.0.1:${proxyPort}`});
      // Leave the installed extension behind, as a lost MCP process would.
      await first.close();
      const second = await launch(options);
      try {
        const page = await second.newPage();
        await page.goto(`http://ghostframe-restart.test:${originPort}/`);
        assert.equal(
          await page.evaluate(() => document.body.textContent),
          'direct route',
        );
      } finally {
        await second.close();
      }
    } finally {
      await controller.dispose();
      if (first.connected) {
        await first.close();
      }
      await Promise.all([close(proxy), close(origin)]);
      await rm(profile, {recursive: true, force: true});
    }
  });

  it('authenticates a startup proxy before the first navigation and lazily initializes', async () => {
    const expected = `Basic ${Buffer.from('startup:credential').toString('base64')}`;
    const proxy = createServer((request, response) => {
      if (request.headers['proxy-authorization'] !== expected) {
        response.writeHead(407, {
          'Proxy-Authenticate': 'Basic realm="startup"',
        });
        response.end();
        return;
      }
      response.writeHead(200, {'Content-Type': 'text/html'});
      response.end('<html><body>startup route</body></html>');
    });
    const port = await listen(proxy);
    const server = `http://127.0.0.1:${port}`;
    const browser = await launch({
      headless: true,
      isolated: true,
      executablePath: executablePath(),
      chromeArgs: [`--proxy-server=${server}`],
    });
    const controller = new ProxyController(browser, {
      server,
      username: 'startup',
      password: 'credential',
    });
    try {
      await controller.get();
      const page = await browser.newPage();
      await page.goto('http://ghostframe-startup.test/');
      assert.equal(
        await page.evaluate(() => document.body.textContent),
        'startup route',
      );
      await controller.set({mode: 'direct'});
      assert.equal((await controller.get()).credentialsConfigured, false);
    } finally {
      await controller.dispose();
      await browser.close();
      await close(proxy);
    }
  });

  it('switches live requests between authenticated proxies and direct without losing tab state', async () => {
    const origin = createServer((_request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', 'text/html');
      response.end('<html><body>original page</body></html>');
    });
    const credentials = `Basic ${Buffer.from('user:secret').toString('base64')}`;
    const authenticatedConnects: string[] = [];
    const unauthenticatedConnects: string[] = [];
    const proxyA = createServer((request, response) => {
      if (request.headers['proxy-authorization'] !== credentials) {
        response.writeHead(407, {'Proxy-Authenticate': 'Basic realm="test"'});
        response.end();
        return;
      }
      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      response.end('proxy-a');
    });
    const proxyB = createServer((_request, response) => {
      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      response.end('proxy-b');
    });
    proxyA.on('connect', (request, socket) => {
      if (request.headers['proxy-authorization'] !== credentials) {
        socket.end(
          'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="test"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
        );
        return;
      }
      if (request.url) {
        authenticatedConnects.push(request.url);
      }
      socket.end(
        'HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
      );
    });
    proxyB.on('connect', (request, socket) => {
      assert.equal(request.headers['proxy-authorization'], undefined);
      if (request.url) {
        unauthenticatedConnects.push(request.url);
      }
      socket.end(
        'HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
      );
    });
    const originPort = await listen(origin);
    const portA = await listen(proxyA);
    const portB = await listen(proxyB);
    const browser = await launch({
      headless: true,
      isolated: true,
      executablePath: executablePath(),
      chromeArgs: ['--host-resolver-rules=MAP ghostframe.test 127.0.0.1'],
    });
    const controller = new ProxyController(browser);
    try {
      await controller.initialize();
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${originPort}/`);
      await page.evaluate(() => {
        localStorage.setItem('state', 'retained');
        document.cookie = 'session=retained';
        document.body.dataset.state = 'retained';
      });
      await controller.set({
        mode: 'proxy',
        server: `http://127.0.0.1:${portA}`,
        username: 'user',
        password: 'secret',
      });
      assert.equal(
        await page.evaluate(() =>
          fetch('http://ghostframe.test/first', {cache: 'no-store'}).then(
            response => response.text(),
          ),
        ),
        'proxy-a',
      );
      await page.evaluate(() =>
        fetch('https://ghostframe-connect.test/first').catch(() => undefined),
      );
      assert(authenticatedConnects.includes('ghostframe-connect.test:443'));
      const authenticated = await controller.get();
      assert.equal(authenticated.credentialsConfigured, true);
      assert.equal(JSON.stringify(authenticated).includes('secret'), false);
      await assert.rejects(
        controller.set({
          mode: 'proxy',
          server: `http://127.0.0.1:${portA}`,
          username: 'user',
          password: 'wrong',
        }),
        /cached authentication/,
      );
      await controller.set({
        mode: 'proxy',
        server: `http://127.0.0.1:${portB}`,
      });
      assert.equal(
        await page.evaluate(() =>
          fetch('http://ghostframe.test/second', {cache: 'no-store'}).then(
            response => response.text(),
          ),
        ),
        'proxy-b',
      );
      await page.evaluate(() =>
        fetch('https://ghostframe-connect.test/second').catch(() => undefined),
      );
      assert(unauthenticatedConnects.includes('ghostframe-connect.test:443'));
      await controller.set({mode: 'direct'});
      assert.equal(
        await page.evaluate(
          port =>
            fetch(`http://ghostframe.test:${port}/direct`, {
              cache: 'no-store',
            }).then(response => response.text()),
          originPort,
        ),
        '<html><body>original page</body></html>',
      );
      assert.deepEqual(
        await page.evaluate(() => ({
          storage: localStorage.getItem('state'),
          cookie: document.cookie,
          dom: document.body.dataset.state,
        })),
        {storage: 'retained', cookie: 'session=retained', dom: 'retained'},
      );
      const before = await controller.get();
      await assert.rejects(
        controller.set({
          mode: 'direct',
          connectionPolicy: 'disconnect_existing',
        }),
        /cannot explicitly close/,
      );
      await assert.rejects(
        controller.set({
          mode: 'proxy',
          server: 'socks5://127.0.0.1:1080',
          username: 'user',
          password: 'secret',
        }),
        /authenticated SOCKS/,
      );
      await assert.rejects(
        controller.set({
          mode: 'proxy',
          server: 'http://user:secret@127.0.0.1:8080',
        }),
        /separate username/,
      );
      assert.equal((await controller.get()).revision, before.revision);
      const unavailable = createServer();
      const unavailablePort = await listen(unavailable);
      await close(unavailable);
      await controller.set({
        mode: 'proxy',
        server: `127.0.0.1:${unavailablePort}`,
      });
      assert.equal(
        await page.evaluate(
          port =>
            fetch(`http://ghostframe.test:${port}/must-not-fallback`, {
              cache: 'no-store',
            }).then(
              () => false,
              () => true,
            ),
          originPort,
        ),
        true,
      );
      assert.equal(
        (await browser.pages()).some(page =>
          page.url().startsWith('chrome-extension://'),
        ),
        false,
      );
    } finally {
      await controller.dispose();
      await browser.close();
      await Promise.all([close(origin), close(proxyA), close(proxyB)]);
    }
  });
});

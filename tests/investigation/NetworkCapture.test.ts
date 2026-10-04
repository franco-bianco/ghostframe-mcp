/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {Duplex} from 'node:stream';
import {describe, it} from 'node:test';

import {NetworkCapture} from '../../src/investigation/NetworkCapture.js';
import {serverHooks} from '../server.js';
import {html, withBrowser} from '../utils.js';

function bodyPath(record: Record<string, unknown>): string {
  assert.equal(typeof record.bodyFilePath, 'string');
  if (typeof record.bodyFilePath !== 'string') {
    throw new Error('Missing body path');
  }
  return record.bodyFilePath;
}

describe('NetworkCapture', () => {
  const server = serverHooks();

  it('retains eager bodies and capture-wide IDs across four navigations and page closure', async () => {
    for (const name of ['one', 'two', 'three', 'four']) {
      server.addHtmlRoute(`/${name}`, html`<main>${name}</main>`);
    }
    await withBrowser(async (browser, page) => {
      const capture = new NetworkCapture(
        browser,
        candidate => (candidate === page ? 42 : undefined),
        async () => undefined,
      );
      const started = await capture.start({page});
      try {
        capture.markAction({tool: 'navigate_page', phase: 'start', pageId: 42});
        for (const name of ['one', 'two', 'three', 'four']) {
          await page.goto(server.getRoute(`/${name}`));
        }
        await page.close();
        await capture.stop(started.captureId);
        const result = await capture.read(started.captureId, 0, 1000);
        const requests = result.records.filter(
          record =>
            record.kind === 'request' && record.resourceType === 'Document',
        );
        assert.equal(requests.length, 4);
        assert.equal(new Set(requests.map(record => record.requestId)).size, 4);
        assert.ok(requests.every(record => record.pageId === 42));
        const first = requests[0];
        assert.ok(first);
        const body = result.records.find(
          record =>
            record.kind === 'response_body' &&
            record.requestId === first.requestId,
        );
        assert.ok(body);
        assert.match(await readFile(bodyPath(body), 'utf8'), /one/);
        assert.ok(result.records.some(record => record.kind === 'action'));
        assert.ok(result.records.some(record => record.kind === 'page_closed'));
        assert.equal(result.active, false);
      } finally {
        await capture.dispose();
        await rm(started.directory, {recursive: true, force: true});
      }
    });
  });

  it('retains authentication, cookie and custom header values without an opt-in', async () => {
    server.addHtmlRoute('/headers-page', '<main>headers</main>');
    server.addRoute('/headers-api', (_request, response) => {
      response.setHeader('X-Signature', 'secret-response');
      response.setHeader('Set-Cookie', 'token=secret-cookie; HttpOnly');
      response.end('payload');
    });
    await withBrowser(async (browser, page) => {
      const capture = new NetworkCapture(
        browser,
        () => 1,
        async () => undefined,
      );
      await page.goto(server.getRoute('/headers-page'));
      const started = await capture.start({page});
      try {
        await page.evaluate(async () => {
          await fetch('/headers-api', {
            headers: {Authorization: 'Bearer secret-request'},
          }).then(response => response.text());
        });
        // Extra-info arrives independently of the page's completed fetch.
        // Keep collection active until the required header evidence arrives.
        for (let attempt = 0; attempt < 100; attempt++) {
          const result = await capture.read(started.captureId, 0, 1000);
          if (JSON.stringify(result.records).includes('secret-cookie')) {
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        await capture.stop(started.captureId);
        const rawText = await readFile(
          `${started.directory}/events.jsonl`,
          'utf8',
        );
        assert.match(rawText, /secret-request/);
        assert.match(rawText, /secret-response/);
        assert.match(rawText, /secret-cookie/);
      } finally {
        await capture.dispose();
        await rm(started.directory, {recursive: true, force: true});
      }
    });
  });

  it('omits oversized bodies with explicit evidence and uses bounded cursor reads', async () => {
    server.addHtmlRoute(
      '/limit',
      '<main>body exceeding the configured budget</main>',
    );
    await withBrowser(async (browser, page) => {
      const capture = new NetworkCapture(
        browser,
        () => 1,
        async () => undefined,
      );
      const started = await capture.start({page, maxBodyBytes: 1});
      try {
        await page.goto(server.getRoute('/limit'));
        await capture.stop(started.captureId);
        const first = await capture.read(started.captureId, 0, 1);
        assert.equal(first.records.length, 1);
        assert.equal(first.nextCursor, 1);
        const rest = await capture.read(
          started.captureId,
          first.nextCursor,
          1000,
        );
        assert.ok(
          rest.records.some(
            record =>
              record.kind === 'response_body' &&
              record.bodyStatus === 'omitted_limit',
          ),
        );
        assert.ok(rest.records.every(record => record.sequence !== 0));
        await assert.rejects(capture.read(started.captureId, -1), /Cursor/);
      } finally {
        await capture.dispose();
        await rm(started.directory, {recursive: true, force: true});
      }
    });
  });

  it('arms before an action and returns nonblocking matched and timed-out observations', async () => {
    server.addHtmlRoute('/wait-page', '<main>wait</main>');
    server.addRoute('/wait-api', (_request, response) => response.end('done'));
    await withBrowser(async (browser, page) => {
      const capture = new NetworkCapture(
        browser,
        () => 3,
        async () => undefined,
      );
      try {
        await page.goto(server.getRoute('/wait-page'));
        const observation = await capture.armNetworkWait({
          page,
          url: '/wait-api',
          method: 'GET',
          phase: 'response',
        });
        assert.equal(
          capture.getNetworkWait(observation.observationId).status,
          'pending',
        );
        await page.evaluate(async () => {
          await fetch('/wait-api').then(response => response.text());
        });
        const result = capture.getNetworkWait(observation.observationId);
        assert.equal(result.status, 'matched');
        assert.equal(result.match?.pageId, 3);
        const expired = await capture.armNetworkWait({
          page,
          url: '/never',
          timeout: 1,
        });
        await page.evaluate(async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
        });
        assert.equal(
          capture.getNetworkWait(expired.observationId).status,
          'timed_out',
        );
        const closed = await capture.armNetworkWait({page, url: '/never'});
        await page.close();
        assert.equal(
          capture.getNetworkWait(closed.observationId).status,
          'cancelled',
        );
      } finally {
        await capture.dispose();
      }
    });
  });

  it('captures EventSource messages without waiting for the response to finish', async () => {
    server.addHtmlRoute('/events-page', '<main>events</main>');
    server.addRoute('/events', (_request, response) => {
      response.writeHead(200, {'Content-Type': 'text/event-stream'});
      response.write('id: 7\nevent: update\ndata: live-content\n\n');
    });
    await withBrowser(async (browser, page) => {
      const capture = new NetworkCapture(
        browser,
        () => 1,
        async () => undefined,
      );
      await page.goto(server.getRoute('/events-page'));
      const started = await capture.start({page});
      try {
        await page.evaluate(async () => {
          await new Promise<void>((resolve, reject) => {
            const events = new EventSource('/events');
            events.addEventListener('update', () => {
              events.close();
              resolve();
            });
            events.onerror = () => {
              events.close();
              reject(new Error('EventSource failed'));
            };
          });
        });
        await capture.stop(started.captureId);
        const result = await capture.read(started.captureId, 0, 1000);
        assert.ok(
          result.records.some(
            record =>
              record.kind === 'eventsource_message' &&
              record.eventId === '7' &&
              record.eventName === 'update',
          ),
        );
        const body = result.records.find(
          record => record.kind === 'eventsource_payload',
        );
        assert.ok(body);
        assert.equal(await readFile(bodyPath(body), 'utf8'), 'live-content');
      } finally {
        await capture.dispose();
        await rm(started.directory, {recursive: true, force: true});
      }
    });
  });

  it('records experimental fetch-stream bytes or an explicit capability gap', async () => {
    server.addHtmlRoute('/stream-page', '<main>stream</main>');
    server.addRoute('/stream', (_request, response) => {
      response.writeHead(200, {'Content-Type': 'text/plain'});
      response.write('first-');
      setTimeout(() => response.end('second'), 30);
    });
    await withBrowser(async (browser, page) => {
      const capture = new NetworkCapture(
        browser,
        () => 1,
        async () => undefined,
      );
      await page.goto(server.getRoute('/stream-page'));
      const started = await capture.start({page, streaming: true});
      try {
        assert.equal(
          await page.evaluate(async () =>
            fetch('/stream').then(response => response.text()),
          ),
          'first-second',
        );
        await capture.stop(started.captureId);
        const result = await capture.read(started.captureId, 0, 1000);
        const streams = result.records.filter(
          record =>
            record.kind === 'stream_chunk' || record.kind === 'stream_buffered',
        );
        if (streams.length > 0) {
          const content = (
            await Promise.all(
              streams.map(record => readFile(bodyPath(record), 'utf8')),
            )
          ).join('');
          assert.match(content, /first-/);
          assert.match(content, /second/);
        } else {
          assert.ok(
            result.records.some(
              record =>
                record.kind === 'coverage_gap' &&
                String(record.reason).includes('streamResourceContent'),
            ),
          );
        }
      } finally {
        await capture.dispose();
        await rm(started.directory, {recursive: true, force: true});
      }
    });
  });

  it('captures future tabs and allocates distinct IDs for their requests', async () => {
    server.addHtmlRoute('/future', '<main>future</main>');
    await withBrowser(async (browser, page) => {
      const capture = new NetworkCapture(
        browser,
        candidate => (candidate === page ? 1 : 2),
        async () => undefined,
      );
      const started = await capture.start();
      try {
        await page.goto(server.getRoute('/future'));
        const second = await browser.newPage();
        capture.addPage(second);
        await second.goto(server.getRoute('/future'));
        await capture.stop(started.captureId);
        await second.close();
        const result = await capture.read(started.captureId, 0, 1000, {
          kind: 'request',
          url: '/future',
        });
        assert.equal(result.records.length, 2);
        assert.notEqual(
          result.records[0]?.requestId,
          result.records[1]?.requestId,
        );
        assert.deepEqual(
          new Set(result.records.map(record => record.pageId)),
          new Set([1, 2]),
        );
      } finally {
        await capture.dispose();
        await rm(started.directory, {recursive: true, force: true});
      }
    });
  });

  it('captures WebSocket handshake and messages with immutable payload files', async () => {
    const sockets = new Set<Duplex>();
    const socketServer = createServer((_request, response) =>
      response.end('<main>socket</main>'),
    );
    socketServer.on('upgrade', (request, socket) => {
      sockets.add(socket);
      const key = request.headers['sec-websocket-key'];
      assert.equal(typeof key, 'string');
      if (typeof key !== 'string') {
        socket.destroy();
        return;
      }
      const accept = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      const payload = Buffer.from('socket-content');
      socket.write(
        Buffer.concat([Buffer.from([0x81, payload.length]), payload]),
      );
    });
    await new Promise<void>(resolve =>
      socketServer.listen(0, '127.0.0.1', resolve),
    );
    const address = socketServer.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;
    try {
      await withBrowser(async (browser, page) => {
        const capture = new NetworkCapture(
          browser,
          () => 1,
          async () => undefined,
        );
        await page.goto(url);
        const started = await capture.start({page});
        try {
          await page.evaluate(async () => {
            await new Promise<void>((resolve, reject) => {
              const socket = new WebSocket(
                location.origin.replace('http:', 'ws:'),
              );
              socket.onopen = () => socket.send('client-content');
              socket.onmessage = () => {
                socket.close();
                resolve();
              };
              socket.onerror = () => reject(new Error('WebSocket failed'));
            });
          });
          await capture.stop(started.captureId);
          const result = await capture.read(started.captureId, 0, 1000);
          assert.ok(
            result.records.some(record => record.kind === 'websocket_request'),
          );
          assert.ok(
            result.records.some(
              record =>
                record.kind === 'websocket_response' && record.status === 101,
            ),
          );
          assert.ok(
            result.records.some(
              record =>
                record.kind === 'websocket_message' &&
                record.direction === 'received',
            ),
          );
          const bodies = result.records.filter(
            record => record.kind === 'websocket_payload',
          );
          const payloads = await Promise.all(
            bodies.map(record => readFile(bodyPath(record), 'utf8')),
          );
          assert.ok(payloads.includes('socket-content'));
          assert.ok(payloads.includes('client-content'));
        } finally {
          await capture.dispose();
          await rm(started.directory, {recursive: true, force: true});
        }
      });
    } finally {
      for (const socket of sockets) {
        socket.destroy();
      }
      socketServer.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        socketServer.close(error => (error ? reject(error) : resolve())),
      );
    }
  });
});

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {describe, it, afterEach, beforeEach} from 'node:test';

import {
  handleResponse,
  sendCommand,
  startDaemon,
  stopDaemon,
} from '../../src/daemon/client.js';
import {
  getDaemonPid,
  getSocketPath,
  isDaemonRunning,
  IS_WINDOWS,
} from '../../src/daemon/utils.js';
import type {CallToolResult} from '../../src/third_party/index.js';

describe('daemon client', () => {
  describe('real daemon lifecycle and status', () => {
    let sessionId: string;

    beforeEach(() => {
      sessionId = crypto.randomUUID();
    });

    afterEach(async () => {
      await stopDaemon(sessionId);
    });

    it('starts one daemon per session and makes repeated start/stop idempotent', async () => {
      assert.equal(isDaemonRunning(sessionId), false);
      await stopDaemon(sessionId);
      await startDaemon([], sessionId);
      const originalPid = getDaemonPid(sessionId);
      assert.equal(isDaemonRunning(sessionId), true);
      assert(originalPid);
      await startDaemon([], sessionId);
      assert.equal(getDaemonPid(sessionId), originalPid);
      const response = await sendCommand({method: 'status'}, sessionId);
      assert.equal(response.success, true);
      assert.equal(JSON.parse(response.result).pid, originalPid);
      await stopDaemon(sessionId);
      await stopDaemon(sessionId);
      assert.equal(isDaemonRunning(sessionId), false);
    });

    it('redacts legacy proxy credentials from actual daemon status', async () => {
      await startDaemon(
        [
          '--allow-legacy-proxy-credentials',
          '--proxy-server',
          '127.0.0.1:8080:status-secret-user:status-secret-password',
        ],
        sessionId,
      );
      const response = await sendCommand({method: 'status'}, sessionId);
      assert.equal(response.success, true);
      assert.equal(response.result.includes('status-secret-user'), false);
      assert.equal(response.result.includes('status-secret-password'), false);
      assert.match(response.result, /\[REDACTED\]/);
    });
  });

  describe('IPC failure boundaries', () => {
    it('rejects a missing peer instead of leaving the command pending', async () => {
      await assert.rejects(
        sendCommand({method: 'status'}, crypto.randomUUID()),
        /ENOENT|ECONNREFUSED/,
      );
    });

    it('rejects when a connected socket closes without a reply', async () => {
      const sessionId = crypto.randomUUID();
      const socketPath = getSocketPath(sessionId);
      if (!IS_WINDOWS) {
        await fs.mkdir(path.dirname(socketPath), {recursive: true});
      }
      const server = net.createServer(socket => {
        socket.once('data', () => socket.destroy());
      });
      await new Promise<void>(resolve => server.listen(socketPath, resolve));
      try {
        await assert.rejects(
          sendCommand({method: 'status'}, sessionId),
          /Socket closed|ECONNRESET|EPIPE/,
        );
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close(error => (error ? reject(error) : resolve())),
        );
        if (!IS_WINDOWS) {
          await fs.rm(socketPath, {force: true});
        }
      }
    });

    it('enforces the response deadline against a real silent socket peer', async t => {
      const sessionId = crypto.randomUUID();
      const socketPath = getSocketPath(sessionId);
      if (!IS_WINDOWS) {
        await fs.mkdir(path.dirname(socketPath), {recursive: true});
      }
      let receiveCommand: (() => void) | undefined;
      const received = new Promise<void>(resolve => {
        receiveCommand = resolve;
      });
      const server = net.createServer(socket =>
        socket.on('data', () => receiveCommand?.()),
      );
      await new Promise<void>(resolve => server.listen(socketPath, resolve));
      t.mock.timers.enable({apis: ['setTimeout']});
      try {
        const rejection = assert.rejects(
          sendCommand({method: 'status'}, sessionId),
          /Timeout waiting for daemon response/,
        );
        await received;
        t.mock.timers.tick(60000);
        await rejection;
      } finally {
        t.mock.timers.reset();
        await new Promise<void>((resolve, reject) =>
          server.close(error => (error ? reject(error) : resolve())),
        );
        if (!IS_WINDOWS) {
          await fs.rm(socketPath, {force: true});
        }
      }
    });
  });

  describe('CLI response conversion', () => {
    it('keeps error details and text fallback usable when structured output is unavailable', async () => {
      const text: CallToolResult = {
        content: [
          {type: 'text', text: 'first'},
          {type: 'text', text: 'second'},
        ],
      };
      assert.equal(await handleResponse(text, 'md'), 'first second');
      assert.deepEqual(JSON.parse(await handleResponse(text, 'json')), [
        'first',
        'second',
      ]);
      const error: CallToolResult = {
        isError: true,
        content: [{type: 'text', text: 'Request denied'}],
      };
      assert.deepEqual(JSON.parse(await handleResponse(error, 'json')), [
        {type: 'text', text: 'Request denied'},
      ]);
      const structured: CallToolResult = {
        content: [],
        structuredContent: {status: 'completed', value: 42},
      };
      assert.deepEqual(JSON.parse(await handleResponse(structured, 'json')), {
        status: 'completed',
        value: 42,
      });
    });

    it('writes image payload bytes to readable artifacts with their declared file type', async () => {
      for (const [mimeType, extension] of [
        ['image/png', '.png'],
        ['image/webp', '.webp'],
        ['image/jpeg', '.jpeg'],
      ]) {
        const bytes = Buffer.from([0, 10, 128, 255, 13]);
        const response: CallToolResult = {
          content: [{type: 'image', data: bytes.toString('base64'), mimeType}],
        };
        const output = await handleResponse(response, 'md');
        const match = output.match(/^Saved to (.+)\.$/);
        assert(match);
        const file = match[1];
        try {
          assert.equal(path.extname(file), extension);
          assert.deepEqual(await fs.readFile(file), bytes);
        } finally {
          await fs.rm(file, {force: true});
        }
      }
    });
  });
});

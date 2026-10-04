/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe, it, afterEach, beforeEach} from 'node:test';

import {executablePath} from 'puppeteer';

import {getDaemonPid} from '../../src/daemon/utils.js';
import {zod} from '../../src/third_party/index.js';
import {serverHooks} from '../server.js';
import {
  assertDaemonIsNotRunning,
  assertDaemonIsRunning,
  runCli,
} from '../utils.js';

describe('CLI daemon and profile lifecycle', () => {
  const server = serverHooks();
  let sessionId: string;

  beforeEach(() => {
    sessionId = crypto.randomUUID();
  });

  afterEach(async () => {
    await runCli(['stop'], sessionId);
    await assertDaemonIsNotRunning(sessionId);
  });

  it('reports stopped/running state and restarts the selected daemon with documented defaults', async () => {
    await assertDaemonIsNotRunning(sessionId);
    const started = await runCli(['start'], sessionId);
    assert.equal(started.status, 0, started.stderr);
    await assertDaemonIsRunning(sessionId);
    const originalPid = getDaemonPid(sessionId);
    assert(originalPid);
    const status = await runCli(['status'], sessionId);
    assert.match(status.stdout, /--headless/);
    assert.match(status.stdout, /--isolated/);
    const restarted = await runCli(['start'], sessionId);
    assert.equal(restarted.status, 0, restarted.stderr);
    assert.notEqual(getDaemonPid(sessionId), originalPid);
    assert.equal((await runCli(['stop'], sessionId)).status, 0);
    await assertDaemonIsNotRunning(sessionId);
    assert.equal((await runCli(['stop'], sessionId)).status, 0);
  });

  it('retains real browser storage across CLI restarts with an explicit userDataDir', async () => {
    server.addHtmlRoute('/profile-page', '<main>Persistent profile</main>');
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ghostframe-profile-test-'),
    );
    const marker = crypto.randomUUID();
    const startArgs = [
      'start',
      '--userDataDir',
      directory,
      '--executablePath',
      executablePath(),
    ];
    try {
      const first = await runCli(startArgs, sessionId);
      assert.equal(first.status, 0, first.stderr);
      const opened = await runCli(
        ['new_page', server.getRoute('/profile-page')],
        sessionId,
      );
      assert.equal(opened.status, 0, opened.stderr);
      const saved = await runCli(
        [
          'runtime_evaluate',
          '() => localStorage.setItem("persisted", "' + marker + '")',
          '--world',
          'main',
        ],
        sessionId,
      );
      assert.equal(saved.status, 0, saved.stderr);
      const beforeRestart = await runCli(
        [
          'runtime_evaluate',
          '() => localStorage.getItem("persisted")',
          '--world',
          'main',
          '--output-format=json',
        ],
        sessionId,
      );
      const savedOutput = zod
        .object({message: zod.string()})
        .parse(JSON.parse(beforeRestart.stdout));
      assert.equal(
        zod
          .object({value: zod.string().nullable()})
          .parse(JSON.parse(savedOutput.message)).value,
        marker,
        'Storage must be readable before stopping the browser',
      );
      assert.equal((await runCli(['stop'], sessionId)).status, 0);
      const second = await runCli(startArgs, sessionId);
      assert.equal(second.status, 0, second.stderr);
      const reopened = await runCli(
        ['new_page', server.getRoute('/profile-page')],
        sessionId,
      );
      assert.equal(reopened.status, 0, reopened.stderr);
      const read = await runCli(
        [
          'runtime_evaluate',
          '() => localStorage.getItem("persisted")',
          '--world',
          'main',
          '--output-format=json',
        ],
        sessionId,
      );
      assert.equal(read.status, 0, read.stderr);
      const output = zod
        .object({message: zod.string()})
        .parse(JSON.parse(read.stdout));
      assert.equal(
        zod
          .object({value: zod.string().nullable()})
          .parse(JSON.parse(output.message)).value,
        marker,
        'An explicit userDataDir must retain browser storage across CLI restarts',
      );
    } finally {
      await runCli(['stop'], sessionId);
      await fs.rm(directory, {recursive: true, force: true});
    }
  });
});

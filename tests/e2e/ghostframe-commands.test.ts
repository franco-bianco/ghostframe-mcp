/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {describe, it, afterEach, beforeEach} from 'node:test';

import {executablePath} from 'puppeteer';

import {
  assertDaemonIsNotRunning,
  assertDaemonIsRunning,
  runCli,
} from '../utils.js';

describe('CLI browser commands', () => {
  let sessionId: string;

  beforeEach(() => {
    sessionId = crypto.randomUUID();
  });

  afterEach(async () => {
    await runCli(['stop'], sessionId);
    await assertDaemonIsNotRunning(sessionId);
  });

  it('invokes browser tools through one persistent daemon and saves a valid PNG artifact', async () => {
    const started = await runCli(
      ['start', '--executablePath', executablePath()],
      sessionId,
    );
    assert.equal(started.status, 0, started.stderr);
    const listed = await runCli(['list_pages'], sessionId);
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /about:blank/);
    const screenshot = await runCli(['take_screenshot'], sessionId);
    assert.equal(screenshot.status, 0, screenshot.stderr);
    const match = screenshot.stdout.match(/Saved to (.+\.png)\./);
    assert(match, screenshot.stdout);
    const file = match[1];
    try {
      const bytes = await fs.readFile(file);
      assert.deepEqual(
        bytes.subarray(0, 8),
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      assert(bytes.length > 8);
    } finally {
      await fs.rm(file, {force: true});
    }
    await assertDaemonIsRunning(sessionId);
  });

  it('reports disabled network tools and explains the launch setting needed to enable them', async () => {
    const started = await runCli(
      [
        'start',
        '--categoryNetwork=false',
        '--executablePath',
        executablePath(),
      ],
      sessionId,
    );
    assert.equal(started.status, 0, started.stderr);
    const result = await runCli(['list_network_requests'], sessionId);
    assert.match(result.stdout, /category Network.*disabled/);
    assert.match(result.stdout, /ghostframe start --categoryNetwork=true/);
    // A tool error currently exits zero; this test preserves the useful error
    // and recovery instruction without declaring that exit code a contract.
  });
});

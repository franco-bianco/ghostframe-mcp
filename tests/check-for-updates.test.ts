/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';

import sinon from 'sinon';

import {
  checkForUpdates,
  resetUpdateCheckFlagForTesting,
} from '../src/utils/check-for-updates.js';
import {VERSION} from '../src/version.js';

describe('legacy update cache policy', () => {
  let taskDirectory: string;
  let cacheFile: string;
  let previousOptOut: string | undefined;
  let spawnStub: sinon.SinonStub;

  beforeEach(async () => {
    previousOptOut = process.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS;
    delete process.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS;
    resetUpdateCheckFlagForTesting();
    taskDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ghostframe-update-test-'),
    );
    cacheFile = path.join(
      taskDirectory,
      '.cache',
      'chrome-devtools-mcp',
      'latest.json',
    );
    sinon.stub(os, 'homedir').returns(taskDirectory);
    // Do not contact the public npm registry. The cache filesystem remains real.
    spawnStub = sinon
      .stub(childProcess, 'spawn')
      .returns(new childProcess.ChildProcess());
  });

  afterEach(async () => {
    sinon.restore();
    resetUpdateCheckFlagForTesting();
    if (previousOptOut === undefined) {
      delete process.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS;
    } else {
      process.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS = previousOptOut;
    }
    await fs.rm(taskDirectory, {recursive: true, force: true});
  });

  async function cache(version: string, ageHours = 0) {
    await fs.mkdir(path.dirname(cacheFile), {recursive: true});
    await fs.writeFile(cacheFile, JSON.stringify({version}));
    const time = new Date(Date.now() - ageHours * 3600000);
    await fs.utimes(cacheFile, time, time);
  }

  it('honors update opt-out without creating cache files or launching a registry check', async () => {
    process.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS = 'true';
    const warn = sinon.stub(console, 'warn');
    await checkForUpdates('Use the configured update procedure.');
    assert.equal(warn.called, false);
    assert.equal(spawnStub.callCount, 0);
    await assert.rejects(fs.stat(cacheFile), {code: 'ENOENT'});
  });

  it('notifies only for newer cached releases and avoids registry checks for fresh caches', async () => {
    const warn = sinon.stub(console, 'warn');
    for (const version of ['99.9.9', VERSION, '0.0.1']) {
      await cache(version);
      resetUpdateCheckFlagForTesting();
      warn.resetHistory();
      await checkForUpdates('Use the configured update procedure.');
      assert.equal(warn.called, version === '99.9.9');
      if (version === '99.9.9') {
        assert.match(String(warn.firstCall.args[0]), /99\.9\.9/);
        assert.match(
          String(warn.firstCall.args[0]),
          /Use the configured update procedure/,
        );
      }
      assert.equal(spawnStub.callCount, 0);
    }
  });

  it('refreshes missing or stale caches once without blocking the caller', async () => {
    for (const age of [undefined, 25]) {
      if (age !== undefined) {
        await cache(VERSION, age);
      }
      resetUpdateCheckFlagForTesting();
      spawnStub.resetHistory();
      await checkForUpdates('Update procedure.');
      await checkForUpdates('Update procedure.');
      assert.equal(spawnStub.callCount, 1);
      const updated = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
      assert.equal(updated.version, VERSION);
      const stats = await fs.stat(cacheFile);
      assert(Date.now() - stats.mtimeMs < 60000);
    }
  });
});

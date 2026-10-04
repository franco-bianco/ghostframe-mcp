/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  cliOptions,
  parseArguments,
} from '../../src/bin/ghostframe-mcp-cli-options.js';
import {serializeArgs} from '../../src/daemon/utils.js';

describe('daemon launch argument serialization', () => {
  it('round-trips real profile, proxy, executable, category and repeated Chrome options', () => {
    const input = parseArguments('1.0.0', [
      'node',
      'ghostframe-mcp',
      '--user-data-dir',
      '/tmp/profile with spaces',
      '--executable-path',
      '/tmp/custom chrome',
      '--proxy-server',
      'http://proxy.example:8080',
      '--headless',
      '--no-category-network',
      "--chrome-arg='--disable-quic'",
      "--chrome-arg='--no-first-run'",
      "--ignore-default-chrome-arg='--disable-extensions'",
    ]);
    assert.deepEqual(input.chromeArg, ['--disable-quic', '--no-first-run']);
    const serialized = serializeArgs(cliOptions, input);
    const reparsed = parseArguments('1.0.0', [
      'node',
      'ghostframe-mcp',
      ...serialized,
    ]);
    assert.equal(reparsed.userDataDir, '/tmp/profile with spaces');
    assert.equal(reparsed.executablePath, '/tmp/custom chrome');
    assert.equal(reparsed.channel, undefined);
    assert.equal(reparsed.proxyServer, 'http://proxy.example:8080');
    assert.equal(reparsed.headless, true);
    assert.equal(reparsed.categoryNetwork, false);
    assert.deepEqual(reparsed.chromeArg, ['--disable-quic', '--no-first-run']);
    assert.deepEqual(reparsed.ignoreDefaultChromeArg, ['--disable-extensions']);
    assert.equal(
      serialized.some(
        argument => argument === 'undefined' || argument === 'null',
      ),
      false,
    );
    assert.equal(serialized.includes('--$0'), false);
    assert.equal(serialized.includes('--_'), false);
  });
});

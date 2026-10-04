/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {parseArguments} from '../src/bin/ghostframe-mcp-cli-options.js';

function parse(...flags: string[]) {
  return parseArguments('1.0.0', ['node', 'ghostframe-mcp', ...flags]);
}

describe('MCP launch arguments', () => {
  it('defaults to headed stable Chrome and conservative file and credential access', () => {
    const args = parse();
    assert.equal(args.headless, false);
    assert.equal(args.channel, 'stable');
    assert.equal(args.userDataDir, undefined);
    assert.equal(args.categoryEmulation, true);
    assert.equal(args.categoryNetwork, true);
    assert.equal(args.allowLegacyProxyCredentials, false);
    assert.equal(args.allowUnrestrictedPaths, false);
  });

  it('selects an explicit profile and custom executable without injecting a conflicting channel', () => {
    const args = parse(
      '--user-data-dir',
      '/tmp/research profile',
      '--executablePath',
      '/tmp/test 123/chrome',
    );
    assert.equal(args.userDataDir, '/tmp/research profile');
    assert.equal(args.executablePath, '/tmp/test 123/chrome');
    assert.equal(args.channel, undefined);
    assert.equal(args.isolated, undefined);
  });

  it('retains viewport and repeated Chrome arguments while honoring disabled categories', () => {
    const args = parse(
      '--viewport',
      '888x777',
      "--chrome-arg='--no-sandbox'",
      "--chrome-arg='--disable-setuid-sandbox'",
      "--ignore-default-chrome-arg='--disable-extensions'",
      "--ignore-default-chrome-arg='--disable-cancel-all-touches'",
      '--no-category-emulation',
      '--no-category-network',
    );
    assert.deepEqual(args.viewport, {width: 888, height: 777});
    assert.deepEqual(args.chromeArg, [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ]);
    assert.deepEqual(args.ignoreDefaultChromeArg, [
      '--disable-extensions',
      '--disable-cancel-all-touches',
    ]);
    assert.equal(args.categoryEmulation, false);
    assert.equal(args.categoryNetwork, false);
  });
});

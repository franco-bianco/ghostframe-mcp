/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {parseArguments} from '../src/bin/ghostframe-mcp-cli-options.js';

describe('cli args parsing', () => {
  const defaultArgs = {
    'category-emulation': true,
    categoryEmulation: true,
    'category-network': true,
    categoryNetwork: true,
    'allow-legacy-proxy-credentials': false,
    allowLegacyProxyCredentials: false,
    'allow-unrestricted-paths': false,
    allowUnrestrictedPaths: false,
    'redact-network-headers': true,
    redactNetworkHeaders: true,
  };

  it('parses with default args', async () => {
    const args = parseArguments('1.0.0', ['node', 'main.js']);
    assert.deepStrictEqual(args, {
      ...defaultArgs,
      _: [],
      headless: false,
      $0: 'ghostframe-mcp',
      channel: 'stable',
    });
  });

  it('parses with user data dir', async () => {
    const args = parseArguments('1.0.0', [
      'node',
      'main.js',
      '--user-data-dir',
      '/tmp/chrome-profile',
    ]);
    assert.deepStrictEqual(args, {
      ...defaultArgs,
      _: [],
      headless: false,
      $0: 'ghostframe-mcp',
      channel: 'stable',
      'user-data-dir': '/tmp/chrome-profile',
      userDataDir: '/tmp/chrome-profile',
    });
  });

  it('parses with executable path', async () => {
    const args = parseArguments('1.0.0', [
      'node',
      'main.js',
      '--executablePath',
      '/tmp/test 123/chrome',
    ]);
    assert.deepStrictEqual(args, {
      ...defaultArgs,
      _: [],
      headless: false,
      $0: 'ghostframe-mcp',
      'executable-path': '/tmp/test 123/chrome',
      e: '/tmp/test 123/chrome',
      executablePath: '/tmp/test 123/chrome',
    });
  });

  it('parses viewport', async () => {
    const args = parseArguments('1.0.0', [
      'node',
      'main.js',
      '--viewport',
      '888x777',
    ]);
    assert.deepStrictEqual(args, {
      ...defaultArgs,
      _: [],
      headless: false,
      $0: 'ghostframe-mcp',
      channel: 'stable',
      viewport: {
        width: 888,
        height: 777,
      },
    });
  });

  it('parses chrome args', async () => {
    const args = parseArguments('1.0.0', [
      'node',
      'main.js',
      `--chrome-arg='--no-sandbox'`,
      `--chrome-arg='--disable-setuid-sandbox'`,
    ]);
    assert.deepStrictEqual(args, {
      ...defaultArgs,
      _: [],
      headless: false,
      $0: 'ghostframe-mcp',
      channel: 'stable',
      'chrome-arg': ['--no-sandbox', '--disable-setuid-sandbox'],
      chromeArg: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  });

  it('parses ignore chrome args', async () => {
    const args = parseArguments('1.0.0', [
      'node',
      'main.js',
      `--ignore-default-chrome-arg='--disable-extensions'`,
      `--ignore-default-chrome-arg='--disable-cancel-all-touches'`,
    ]);
    assert.deepStrictEqual(args, {
      ...defaultArgs,
      _: [],
      headless: false,
      $0: 'ghostframe-mcp',
      channel: 'stable',
      'ignore-default-chrome-arg': [
        '--disable-extensions',
        '--disable-cancel-all-touches',
      ],
      ignoreDefaultChromeArg: [
        '--disable-extensions',
        '--disable-cancel-all-touches',
      ],
    });
  });

  it('parses disabled category', async () => {
    const args = parseArguments('1.0.0', [
      'node',
      'main.js',
      '--no-category-emulation',
    ]);
    assert.deepStrictEqual(args, {
      ...defaultArgs,
      _: [],
      headless: false,
      $0: 'ghostframe-mcp',
      channel: 'stable',
      'category-emulation': false,
      categoryEmulation: false,
    });
  });
});

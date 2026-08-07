/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {parseProxy} from '../src/utils/proxy.js';
import {
  redactCommandLineArgs,
  redactSensitiveValues,
} from '../src/utils/redact.js';

describe('proxy', () => {
  it('uses no proxy when none is configured', () => {
    assert.strictEqual(parseProxy(undefined), undefined);
  });

  it('normalizes bare HTTP proxies', () => {
    assert.deepStrictEqual(parseProxy('127.0.0.1:8080'), {
      server: 'http://127.0.0.1:8080',
    });
  });

  it('uses environment credentials for HTTP proxies', () => {
    assert.deepStrictEqual(
      parseProxy('127.0.0.1:8080', {
        username: 'user',
        password: 'pass',
      }),
      {
        server: 'http://127.0.0.1:8080',
        username: 'user',
        password: 'pass',
      },
    );
  });

  it('requires opt-in for IP:PORT:USER:PASS', () => {
    assert.throws(() => parseProxy('127.0.0.1:8080:user:pass'), /disabled/);
    assert.deepStrictEqual(
      parseProxy('127.0.0.1:8080:user:pass', {
        allowLegacyCredentials: true,
      }),
      {
        server: 'http://127.0.0.1:8080',
        username: 'user',
        password: 'pass',
      },
    );
  });

  it('rejects authenticated SOCKS proxies', () => {
    assert.throws(
      () =>
        parseProxy('socks5://127.0.0.1:1080', {
          username: 'user',
          password: 'pass',
        }),
      /does not support authenticated SOCKS/,
    );
  });

  it('redacts credentials and headers', () => {
    assert.deepStrictEqual(
      redactCommandLineArgs([
        '--proxy-server',
        'http://user:pass@example.com:8080',
        '--ws-headers={"Authorization":"token"}',
      ]),
      ['--proxy-server', '[REDACTED]', '--ws-headers=[REDACTED]'],
    );
    assert.deepStrictEqual(
      redactSensitiveValues({url: 'example', authorization: 'token'}),
      {url: 'example', authorization: '[REDACTED]'},
    );
  });
});

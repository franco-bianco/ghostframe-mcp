/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, it} from 'node:test';

import {NetworkFormatter} from '../../src/formatters/NetworkFormatter.js';
import type {HTTPRequest} from '../../src/third_party/index.js';
import {getMockRequest, getMockResponse} from '../utils.js';

describe('NetworkFormatter', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'network-formatter-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, {recursive: true, force: true});
  });

  describe('toString', () => {
    it('works', async () => {
      const request = getMockRequest();
      const formatter = await NetworkFormatter.from(request, {
        requestId: 1,
        saveFile: async () => ({filename: ''}),
      });

      assert.equal(
        formatter.toString(),
        'reqid=1 GET http://example.com [pending]',
      );
    });
    it('shows correct method', async () => {
      const request = getMockRequest({method: 'POST'});
      const formatter = await NetworkFormatter.from(request, {
        requestId: 1,
        saveFile: async () => ({filename: ''}),
      });

      assert.equal(
        formatter.toString(),
        'reqid=1 POST http://example.com [pending]',
      );
    });
    it('preserves informational, successful and redirect status codes', async () => {
      for (const status of [199, 200, 300]) {
        const formatter = await NetworkFormatter.from(
          getMockRequest({response: getMockResponse({status})}),
          {
            requestId: 1,
          },
        );
        assert.equal(formatter.toJSON().status, String(status));
        assert.match(formatter.toString(), new RegExp(`\\[${status}\\]`));
      }
    });

    it('shows correct status for request that failed', async () => {
      const request = getMockRequest({
        failure() {
          return {
            errorText: 'Error in Network',
          };
        },
      });
      const formatter = await NetworkFormatter.from(request, {
        requestId: 1,
        saveFile: async () => ({filename: ''}),
      });

      assert.equal(
        formatter.toString(),
        'reqid=1 GET http://example.com [Error in Network]',
      );
    });

    it('marks requests selected in DevTools UI', async () => {
      const request = getMockRequest();
      const formatter = await NetworkFormatter.from(request, {
        requestId: 1,
        selectedInDevToolsUI: true,
        saveFile: async () => ({filename: ''}),
      });

      assert.equal(
        formatter.toString(),
        'reqid=1 GET http://example.com [pending] [selected in the DevTools Network panel]',
      );
    });
  });

  describe('toStringDetailed', () => {
    it('works with request body from fetchPostData', async () => {
      const request = getMockRequest({
        hasPostData: true,
        postData: undefined,
        fetchPostData: Promise.resolve('test'),
      });
      const formatter = await NetworkFormatter.from(request, {
        requestId: 200,
        fetchData: true,
        saveFile: async () => ({filename: ''}),
      });
      const result = formatter.toStringDetailed();
      assert.match(result, /test/);
    });

    it('works with request body from postData', async () => {
      const request = getMockRequest({
        postData: JSON.stringify({
          request: 'body',
        }),
        hasPostData: true,
      });
      const formatter = await NetworkFormatter.from(request, {
        requestId: 200,
        fetchData: true,
        saveFile: async () => ({filename: ''}),
      });
      const result = formatter.toStringDetailed();

      assert.match(
        result,
        new RegExp(
          JSON.stringify({
            request: 'body',
          }),
        ),
      );
    });

    it('keeps request bodies at the inline limit and marks longer bodies as truncated', async () => {
      const exact = 'x'.repeat(10000);
      const atLimit = await NetworkFormatter.from(
        getMockRequest({postData: exact, hasPostData: true}),
        {
          fetchData: true,
        },
      );
      assert.equal(atLimit.toJSONDetailed().requestBody, exact);
      const overLimit = await NetworkFormatter.from(
        getMockRequest({postData: exact + 'tail', hasPostData: true}),
        {
          fetchData: true,
        },
      );
      assert.equal(
        overLimit.toJSONDetailed().requestBody,
        exact + '... <truncated>',
      );
      assert.ok(!overLimit.toStringDetailed().includes('tail'));
    });

    it('saves full bodies and exposes their paths in text and structured output', async () => {
      const response = getMockResponse();
      response.buffer = async () => Buffer.from('response body');
      const request = getMockRequest({
        method: 'POST',
        postData: 'request body',
        hasPostData: true,
        response,
      });
      const reqPath = join(tmpDir, 'request.network-request');
      const resPath = join(tmpDir, 'response.network-response');
      const formatter = await NetworkFormatter.from(request, {
        fetchData: true,
        requestFilePath: reqPath,
        responseFilePath: resPath,
        saveFile: async (data, filename) => {
          await writeFile(filename, data);
          return {filename};
        },
      });
      const json = formatter.toJSONDetailed();
      assert.equal(json.requestBodyFilePath, reqPath);
      assert.equal(json.responseBodyFilePath, resPath);
      assert.equal(json.requestBody, undefined);
      assert.equal(json.responseBody, undefined);
      assert.equal(await readFile(reqPath, 'utf8'), 'request body');
      assert.equal(await readFile(resPath, 'utf8'), 'response body');
      const text = formatter.toStringDetailed();
      assert.ok(text.includes(reqPath));
      assert.ok(text.includes(resPath));
    });

    it('should not truncate large bodies when saving to file', async () => {
      const largeBody = 'a'.repeat(10005);
      const request = {
        method: () => 'POST',
        url: () => 'http://example.com',
        headers: () => ({}),
        hasPostData: () => true,
        postData: () => largeBody,
        response: () => ({
          status: () => 200,
          headers: () => ({}),
          buffer: async () => Buffer.from(largeBody),
        }),
        failure: () => null,
        redirectChain: () => [],
        fetchPostData: async () => undefined,
      } as unknown as HTTPRequest;

      const reqPath = join(tmpDir, 'test_req_large_' + Date.now());
      const resPath = join(tmpDir, 'test_res_large_' + Date.now());

      await NetworkFormatter.from(request, {
        fetchData: true,
        requestFilePath: reqPath,
        responseFilePath: resPath,
        saveFile: async (data, filename) => {
          await writeFile(filename, data);
          return {filename};
        },
      });

      const reqContent = await readFile(reqPath, 'utf8');
      const resContent = await readFile(resPath, 'utf8');

      assert.strictEqual(reqContent, largeBody);
      assert.strictEqual(resContent, largeBody);
    });

    it('handles response body', async () => {
      const response = getMockResponse();
      response.buffer = () => {
        return Promise.resolve(Buffer.from(JSON.stringify({response: 'body'})));
      };
      const request = getMockRequest({response});

      const formatter = await NetworkFormatter.from(request, {
        requestId: 200,
        fetchData: true,
        saveFile: async () => ({filename: ''}),
      });
      const result = formatter.toStringDetailed();

      assert.match(result, /"response":"body"/);
    });

    it('serializes every redirect with its request identity', async () => {
      const first = getMockRequest({
        url: 'http://example.com/first',
        stableId: 2,
      });
      const second = getMockRequest({
        url: 'http://example.com/second',
        stableId: 3,
      });
      const chain = [first, second];
      const request = getMockRequest({redirectChain: chain});
      request.redirectChain = () => [...chain];
      const formatter = await NetworkFormatter.from(request, {
        requestId: 1,
        requestIdResolver: request =>
          request.url().endsWith('/first') ? 2 : 3,
      });
      const redirects = formatter.toJSONDetailed().redirectChain;
      assert.deepEqual(
        redirects
          ?.map(request => ({requestId: request.requestId, url: request.url}))
          .sort((left, right) => left.url.localeCompare(right.url)),
        [
          {requestId: 2, url: 'http://example.com/first'},
          {requestId: 3, url: 'http://example.com/second'},
        ],
      );
      const text = formatter.toStringDetailed();
      assert.ok(
        text.includes('http://example.com/first') &&
          text.includes('http://example.com/second'),
      );
    });

    it('handles missing bodies with filepath', async () => {
      const request = {
        method: () => 'POST',
        url: () => 'http://example.com',
        headers: () => ({}),
        hasPostData: () => true, // Claim we have data
        postData: () => null, // But returns null
        response: () => ({
          status: () => 200,
          headers: () => ({}),
          buffer: async () => {
            throw new Error('Body not available');
          },
        }),
        failure: () => null,
        redirectChain: () => [],
        fetchPostData: async () => {
          throw new Error('Body not available');
        },
      } as unknown as HTTPRequest;

      const reqPath = join(tmpDir, 'req_missing.txt');
      const resPath = join(tmpDir, 'res_missing.txt');

      const formatter = await NetworkFormatter.from(request, {
        fetchData: true,
        requestFilePath: reqPath,
        responseFilePath: resPath,
        saveFile: async (data, filename) => {
          await writeFile(filename, data);
          return {filename};
        },
      });

      const result = formatter.toStringDetailed();
      assert.ok(
        result.includes(
          `### Response Body\n<Response body not available anymore>`,
        ),
      );
    });
  });

  describe('toJSON', () => {
    it('returns structured data', async () => {
      const request = getMockRequest();
      const formatter = await NetworkFormatter.from(request, {
        requestId: 1,
        selectedInDevToolsUI: true,
        saveFile: async () => ({filename: ''}),
      });
      const result = formatter.toJSON();
      assert.deepEqual(result, {
        requestId: 1,
        method: 'GET',
        url: 'http://example.com',
        status: 'pending',
        selectedInDevToolsUI: true,
      });
    });
  });

  describe('toJSONDetailed', () => {
    it('returns structured detailed data', async () => {
      const response = getMockResponse();
      response.buffer = () => Promise.resolve(Buffer.from('response'));
      const request = getMockRequest({
        response,
        postData: 'request',
        hasPostData: true,
      });
      const formatter = await NetworkFormatter.from(request, {
        requestId: 1,
        fetchData: true,
        saveFile: async () => ({filename: ''}),
      });
      const result = formatter.toJSONDetailed();
      assert.deepEqual(result, {
        requestId: 1,
        method: 'GET',
        url: 'http://example.com',
        status: '200',
        selectedInDevToolsUI: undefined,
        requestHeaders: {
          'content-size': '10',
        },
        requestBody: 'request',
        requestBodyFilePath: undefined,
        responseHeaders: {},
        responseBody: 'response',
        responseBodyFilePath: undefined,
        failure: undefined,
        redirectChain: undefined,
      });
    });

    it('retains complete cookie and authentication header values', async () => {
      const response = getMockResponse({
        headers: {
          'set-cookie': 'secret=123',
          'content-type': 'text/plain',
        },
      });
      response.buffer = () => Promise.resolve(Buffer.from('response'));
      const request = getMockRequest({
        response,
        headers: {
          cookie: 'secret=123',
          authorization: 'Bearer complete-token',
          'user-agent': 'test',
        },
      });
      const formatter = await NetworkFormatter.from(request, {
        requestId: 1,
        fetchData: true,
        saveFile: async () => ({filename: ''}),
      });
      const result = formatter.toJSONDetailed();
      assert.deepEqual(result.requestHeaders, {
        cookie: 'secret=123',
        authorization: 'Bearer complete-token',
        'user-agent': 'test',
      });
      assert.deepEqual(result.responseHeaders, {
        'set-cookie': 'secret=123',
        'content-type': 'text/plain',
      });
    });
  });
});

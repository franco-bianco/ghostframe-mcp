/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {setTimeout} from 'node:timers/promises';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {executablePath} from 'puppeteer';

import {zod} from '../../src/third_party/index.js';
import {serverHooks} from '../server.js';

const recordSchema = zod.record(zod.string(), zod.unknown());
const operationSchema = zod.object({
  operationId: zod.string(),
  status: zod.string(),
  executionMayContinue: zod.boolean(),
  result: zod.object({value: zod.unknown()}).optional(),
});

async function withClient(
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [
      'build/src/bin/ghostframe-mcp.js',
      '--headless',
      '--isolated',
      '--executable-path',
      executablePath(),
    ],
    stderr: 'pipe',
  });
  const client = new Client({name: 'investigation-e2e', version: '1.0.0'});
  try {
    await client.connect(transport);
    await run(client);
  } finally {
    await client.close();
  }
}

async function objectResult(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  // A blocked foreground tool mutex must fail this test quickly instead of
  // being hidden by the browser debugger/interception's eventual deadline.
  const result = await client.callTool({name, arguments: args}, undefined, {
    timeout: 5000,
  });
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  const message = recordSchema.parse(result.structuredContent).message;
  assert.equal(typeof message, 'string');
  if (typeof message !== 'string') {
    throw new Error('Expected a structured tool message.');
  }
  return recordSchema.parse(JSON.parse(message));
}

async function waitForState(
  read: () => Promise<Record<string, unknown>>,
  ready: (state: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await read();
    if (ready(state)) {
      return state;
    }
    await setTimeout(10);
  }
  throw new Error('Expected investigation state was not reached.');
}

async function navigate(client: Client, url: string): Promise<void> {
  const result = await client.callTool(
    {name: 'navigate_page', arguments: {url}},
    undefined,
    {timeout: 30000},
  );
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
}

describe('MCP investigation operation orchestration', () => {
  const server = serverHooks();

  it('returns a pending operation at a function breakpoint and permits inspection and resume', async () => {
    server.addHtmlRoute(
      '/debugger-page',
      `<main>Debugger flow</main><script>
      globalThis.investigated = function investigated(value) {
        globalThis.completed = true;
        return value + 1;
      };
    </script>`,
    );
    await withClient(async client => {
      await navigate(client, server.getRoute('/debugger-page'));
      const retained = await objectResult(client, 'runtime_evaluate', {
        function: '() => globalThis.investigated',
        world: 'main',
        returnMode: 'handle',
      });
      const handle = zod.string().parse(retained.handle);
      await objectResult(client, 'debugger_control', {
        action: 'start',
        timeoutMs: 30000,
      });
      await objectResult(client, 'debugger_control', {
        action: 'breakpoint',
        kind: 'function',
        handle,
      });
      const started = operationSchema.parse(
        await objectResult(client, 'start_action', {
          action: 'call_handle',
          handle,
          args: JSON.stringify([{value: 41}]),
          timeout: 10000,
        }),
      );
      assert.equal(started.status, 'running');
      assert.equal(started.executionMayContinue, true);
      const paused = await waitForState(
        () => objectResult(client, 'debugger_control', {action: 'status'}),
        state => state.paused !== undefined,
      );
      const frames = zod
        .object({
          callFrames: zod.array(zod.object({functionName: zod.string()})),
        })
        .parse(paused.paused);
      assert(
        frames.callFrames.some(frame => frame.functionName === 'investigated'),
      );
      const pending = operationSchema.parse(
        await objectResult(client, 'get_operation', {
          operationId: started.operationId,
        }),
      );
      assert.equal(pending.status, 'running');
      assert.equal(pending.result, undefined);
      const foreground = await client.callTool(
        {
          name: 'evaluate_script',
          arguments: {function: '() => 7'},
        },
        undefined,
        {timeout: 5000},
      );
      assert.equal(foreground.isError, true);
      assert.match(
        JSON.stringify(foreground.content),
        /unfinished action|paused/,
      );
      await objectResult(client, 'debugger_control', {action: 'resume'});
      const finished = operationSchema.parse(
        await waitForState(
          () =>
            objectResult(client, 'get_operation', {
              operationId: started.operationId,
            }),
          state => state.executionMayContinue === false,
        ),
      );
      assert.equal(finished.status, 'completed');
      assert.equal(finished.result?.value, 42);
      const cancelled = operationSchema.parse(
        await objectResult(client, 'start_action', {
          action: 'call_handle',
          handle,
          args: JSON.stringify([{value: 1}]),
        }),
      );
      await waitForState(
        () => objectResult(client, 'debugger_control', {action: 'status'}),
        state => state.paused !== undefined,
      );
      const released = await client.callTool(
        {
          name: 'release_handles',
          arguments: {handles: [handle]},
        },
        undefined,
        {timeout: 5000},
      );
      assert.equal(released.isError, undefined);
      const stopped = await objectResult(client, 'cancel_operation', {
        operationId: cancelled.operationId,
      });
      assert.equal(stopped.status, 'cancelled');
      await objectResult(client, 'debugger_control', {action: 'stop'});
      await waitForState(
        () =>
          objectResult(client, 'get_operation', {
            operationId: cancelled.operationId,
          }),
        state => state.executionMayContinue === false,
      );
      assert.equal(
        (await objectResult(client, 'runtime_evaluate', {function: '() => 43'}))
          .value,
        43,
      );
    });
  });

  it('permits reading and mutating a paused request while its MCP action is pending', async () => {
    server.addHtmlRoute('/interception-page', '<main>Interception flow</main>');
    let requestCount = 0;
    let receivedBody = '';
    let receivedSignature: string | string[] | undefined;
    server.addRoute('/operation-api', (request, response) => {
      requestCount++;
      receivedSignature = request.headers['x-signature'];
      request.on('data', chunk => {
        receivedBody += String(chunk);
      });
      request.on('end', () => response.end('accepted'));
    });
    await withClient(async client => {
      await navigate(client, server.getRoute('/interception-page'));
      const armed = await objectResult(client, 'arm_interception', {
        urlPattern: server.getRoute('/operation-api'),
        method: 'POST',
        timeout: 30000,
      });
      const interceptionId = zod.string().parse(armed.interceptionId);
      const started = operationSchema.parse(
        await objectResult(client, 'start_action', {
          action: 'evaluate',
          function:
            '() => fetch("/operation-api", {method: "POST", body: "original"}).then(response => response.text())',
          timeout: 10000,
        }),
      );
      assert.equal(started.status, 'running');
      const paused = await waitForState(
        () => objectResult(client, 'read_interception', {interceptionId}),
        state => state.status === 'paused',
      );
      assert.equal(
        zod.object({postData: zod.string()}).parse(paused.request).postData,
        'original',
      );
      assert.equal(requestCount, 0);
      assert.equal(
        operationSchema.parse(
          await objectResult(client, 'get_operation', {
            operationId: started.operationId,
          }),
        ).status,
        'running',
      );
      const foreground = await client.callTool(
        {
          name: 'evaluate_script',
          arguments: {function: '() => 7'},
        },
        undefined,
        {timeout: 5000},
      );
      assert.equal(foreground.isError, true);
      assert.match(
        JSON.stringify(foreground.content),
        /unfinished action|start_action/,
      );
      const resolved = await objectResult(client, 'resolve_interception', {
        interceptionId,
        action: 'continue',
        postData: 'changed',
        headers: ['Content-Type: text/plain', 'X-Signature: live-signature'],
      });
      assert.equal(resolved.status, 'resolved');
      const finished = operationSchema.parse(
        await waitForState(
          () =>
            objectResult(client, 'get_operation', {
              operationId: started.operationId,
            }),
          state => state.executionMayContinue === false,
        ),
      );
      assert.equal(finished.status, 'completed');
      assert.equal(finished.result?.value, 'accepted');
      assert.equal(requestCount, 1);
      assert.equal(receivedBody, 'changed');
      assert.equal(receivedSignature, 'live-signature');
    });
  });

  it('keeps the tool queue available while IO.read stalls and aborts the original request on cancellation', async () => {
    server.addHtmlRoute('/stream-page', '<main>stream test</main>');
    let requestCount = 0;
    server.addRoute('/stream-api', (_request, response) => {
      requestCount++;
      response.write('x'.repeat(65536));
    });
    await withClient(async client => {
      await navigate(client, server.getRoute('/stream-page'));
      const armed = await objectResult(client, 'arm_interception', {
        urlPattern: server.getRoute('/stream-api'),
        stage: 'response',
        timeout: 30000,
      });
      const interceptionId = zod.string().parse(armed.interceptionId);
      const operation = await objectResult(client, 'start_action', {
        action: 'evaluate',
        function:
          'async () => { try { await fetch("/stream-api").then(response => response.text()); return {failed: false}; } catch { return {failed: true}; } }',
      });
      const operationId = zod.string().parse(operation.operationId);
      await waitForState(
        () => objectResult(client, 'read_interception', {interceptionId}),
        state => state.status === 'paused',
      );
      const startedRead = await objectResult(client, 'read_interception', {
        interceptionId,
        includeBody: true,
        maxBodyBytes: 131072,
      });
      assert.equal(recordSchema.parse(startedRead.body).status, 'reading');
      await waitForState(
        () =>
          objectResult(client, 'read_interception', {
            interceptionId,
            includeBody: true,
          }),
        state => {
          const body = recordSchema.parse(state.body);
          return body.status === 'reading' && body.bytesRead === 65536;
        },
      );
      const pending = await objectResult(client, 'get_operation', {
        operationId,
      });
      assert.equal(pending.status, 'running');
      const cancelled = await objectResult(client, 'resolve_interception', {
        interceptionId,
        action: 'cancel',
      });
      assert.equal(cancelled.releaseAction, 'aborted');
      const finished = await waitForState(
        () => objectResult(client, 'get_operation', {operationId}),
        state => state.executionMayContinue === false,
      );
      assert.equal(finished.status, 'completed');
      assert.deepEqual(recordSchema.parse(finished.result).value, {
        failed: true,
      });
      assert.equal(
        (await objectResult(client, 'runtime_evaluate', {function: '() => 42'}))
          .value,
        42,
      );
      assert.equal(requestCount, 1);
    });
  });
});

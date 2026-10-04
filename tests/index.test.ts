/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  ListRootsRequestSchema,
  RootsListChangedNotificationSchema,
  type ClientCapabilities,
} from '@modelcontextprotocol/sdk/types.js';
import {executablePath} from 'puppeteer';

import {zod} from '../src/third_party/index.js';

const pagesSchema = zod.object({
  pages: zod.array(
    zod.object({id: zod.number(), url: zod.string(), selected: zod.boolean()}),
  ),
});
const dialogSchema = zod.object({
  dialog: zod.object({type: zod.literal('alert'), message: zod.string()}),
});

describe('e2e', () => {
  async function withClient(
    cb: (client: Client) => Promise<void>,
    extraArgs: string[] = [],
    options: {capabilities?: ClientCapabilities} = {},
  ) {
    const transport = new StdioClientTransport({
      command: 'node',
      env: {...getDefaultEnvironment(), TMPDIR: os.tmpdir()},
      args: [
        'build/src/bin/ghostframe-mcp.js',
        '--headless',
        '--isolated',
        '--executable-path',
        executablePath(),
        ...extraArgs,
      ],
    });
    const client = new Client(
      {
        name: 'e2e-test',
        version: '1.0.0',
      },
      {
        capabilities: options.capabilities ?? {},
      },
    );

    try {
      await client.connect(transport);
      await cb(client);
    } finally {
      await client.close();
    }
  }
  it('preserves browser state between MCP calls', async () => {
    await withClient(async client => {
      const result = await client.callTool({
        name: 'list_pages',
        arguments: {},
      });
      assert.equal(result.isError, undefined);
      const initial = pagesSchema.parse(result.structuredContent);
      assert(
        initial.pages.some(page => page.url === 'about:blank' && page.selected),
      );
      const url = 'data:text/html,<title>Persistent MCP state</title>';
      await client.callTool({name: 'new_page', arguments: {url}});
      const listed = await client.callTool({
        name: 'list_pages',
        arguments: {},
      });
      const current = pagesSchema.parse(listed.structuredContent);
      assert(current.pages.some(page => page.url === url && page.selected));
      assert(
        initial.pages.every(page =>
          current.pages.some(
            current => current.id === page.id && current.url === page.url,
          ),
        ),
      );
    });
  });

  it('advertises required investigation capabilities and applies category settings', async () => {
    await withClient(async client => {
      const {tools} = await client.listTools();
      const names = new Set(tools.map(tool => tool.name));
      for (const name of [
        'new_page',
        'click',
        'evaluate_script',
        'start_capture',
        'read_capture',
        'arm_interception',
        'start_action',
        'runtime_evaluate',
        'get_event_listeners',
        'debugger_control',
        'session_cookies',
        'set_proxy',
      ]) {
        assert(
          names.has(name),
          `Required capability ${name} was not advertised.`,
        );
      }
      for (const name of [
        'lighthouse_audit',
        'performance_start_trace',
        'take_heap_snapshot',
      ]) {
        assert.equal(
          names.has(name),
          false,
          `Excluded capability ${name} was advertised.`,
        );
      }
      const action = tools.find(tool => tool.name === 'start_action');
      assert(
        action?.inputSchema.properties?.pageId,
        'Actions must permit explicit page selection.',
      );
    });
    await withClient(
      async client => {
        const {tools} = await client.listTools();
        const names = new Set(tools.map(tool => tool.name));
        assert.equal(names.has('set_proxy'), false);
        assert.equal(names.has('start_capture'), false);
        assert(names.has('new_page'));
      },
      ['--category-network=false'],
    );
  });

  it('updates roots when client notifies', async () => {
    const roots = [{uri: 'file:///test-root', name: 'test-root'}];
    let resolvePromise: () => void;
    const promise = new Promise<void>(resolve => {
      resolvePromise = resolve;
    });

    await withClient(
      async client => {
        client.setRequestHandler(ListRootsRequestSchema, () => {
          resolvePromise();
          return {roots};
        });

        await client.notification({
          method: RootsListChangedNotificationSchema.shape.method.value,
        });

        // Wait for the server to process the notification and request roots
        await promise;
      },
      [],
      {
        capabilities: {
          roots: {listChanged: true},
        },
      },
    );
  });

  it('denies file access if roots list is empty', async () => {
    await withClient(
      async client => {
        client.setRequestHandler(ListRootsRequestSchema, () => {
          return {roots: []};
        });

        const result = await client.callTool({
          name: 'take_screenshot',
          arguments: {
            filePath: path.resolve(os.homedir(), 'test.png'),
          },
        });

        assert.strictEqual(result.isError, true);
        zod
          .object({errorMessage: zod.string()})
          .parse(result.structuredContent);
      },
      [],
      {
        capabilities: {
          roots: {listChanged: true},
        },
      },
    );
  });

  it('allows file access if roots capability is missing', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ghostframe-roots-contract-'),
    );
    const filePath = path.join(directory, 'capture.png');
    try {
      await withClient(
        async client => {
          const result = await client.callTool({
            name: 'take_screenshot',
            arguments: {
              filePath,
            },
          });

          assert.strictEqual(
            result.isError,
            undefined,
            JSON.stringify(result.content),
          );
          const image = await fs.readFile(filePath);
          assert(
            image
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
          );
        },
        [],
        {
          capabilities: {},
        },
      );
    } finally {
      await fs.rm(directory, {recursive: true, force: true});
    }
  });

  describe('Dialogs', () => {
    async function createNewPageAndTriggerDialog(client: Client) {
      // Navigate to a page with a button that triggers a dialog on click
      await client.callTool({
        name: 'new_page',
        arguments: {
          url: `data:text/html,<button id="test" onclick="alert('test dialog')">Click me</button>`,
        },
      });

      const snapshotResult = await client.callTool({
        name: 'take_snapshot',
        arguments: {},
      });

      const snapshotContent = snapshotResult.content;
      assert(Array.isArray(snapshotContent));
      const textBlock = snapshotContent.find(
        block =>
          typeof block === 'object' &&
          block !== null &&
          'type' in block &&
          block.type === 'text',
      );
      assert(
        textBlock && 'text' in textBlock && typeof textBlock.text === 'string',
      );
      const snapshotText = textBlock.text;
      const match = snapshotText.match(/uid=(\d+_\d+)\s+button "Click me"/);
      assert(match, 'The browser snapshot must provide a button UID.');
      const uid = match[1];

      // Trigger the dialog
      const result = await client.callTool({
        name: 'click',
        arguments: {
          uid,
        },
      });

      return result;
    }

    it('reports an alert and blocks actions until the dialog is handled', async () => {
      await withClient(async client => {
        const opened = await createNewPageAndTriggerDialog(client);
        assert.equal(
          dialogSchema.parse(opened.structuredContent).dialog.message,
          'test dialog',
        );
        const result = await client.callTool({
          name: 'take_screenshot',
          arguments: {
            filePath: '/tmp/test.png',
          },
        });

        assert.equal(result.isError, true);
        assert.equal(
          dialogSchema.parse(result.structuredContent).dialog.message,
          'test dialog',
        );
        const handled = await client.callTool({
          name: 'handle_dialog',
          arguments: {action: 'accept'},
        });
        assert.equal(handled.isError, undefined);
        const resumed = await client.callTool({
          name: 'take_snapshot',
          arguments: {},
        });
        assert.equal(resumed.isError, undefined);
        assert.equal(
          zod
            .record(zod.string(), zod.unknown())
            .parse(resumed.structuredContent).dialog,
          undefined,
        );
      });
    });

    it('permits a new page while another page has an alert', async () => {
      await withClient(async client => {
        await createNewPageAndTriggerDialog(client);
        const result = await client.callTool({
          name: 'new_page',
          arguments: {
            url: `data:text/html,<h1>New</h1>`,
          },
        });

        assert.equal(result.isError, undefined);
        const pages = pagesSchema.parse(result.structuredContent).pages;
        assert(
          pages.some(
            page => page.url === 'data:text/html,<h1>New</h1>' && page.selected,
          ),
        );
      });
    });
  });
});

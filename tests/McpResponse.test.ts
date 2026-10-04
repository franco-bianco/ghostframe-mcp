/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';

import {} from '../src/tools/pages.js';
import type {ResourceType} from '../src/third_party/index.js';

import {serverHooks} from './server.js';
import {
  getImageContent,
  getMockAggregatedIssue,
  getMockRequest,
  getMockResponse,
  getTextContent,
  html,
  stabilizeResponseOutput,
  stabilizeStructuredContent,
  withMcpContext,
} from './utils.js';

describe('McpResponse', () => {
  it('list pages', async () => {
    await withMcpContext(async (response, context) => {
      response.setIncludePages(true);
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      assert.equal(content[0].type, 'text');
      assert.match(getTextContent(content[0]), /1: about:blank.*\[selected\]/);
      assert.deepEqual(structuredContent, {
        pages: [{id: 1, url: 'about:blank', selected: true}],
      });
    });
  });

  it('serializes response lines in insertion order', async () => {
    await withMcpContext(async (response, context) => {
      response.appendResponseLine('Testing 1');
      response.appendResponseLine('Testing 2');
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      assert.deepEqual(structuredContent, {message: 'Testing 1\nTesting 2'});
      const text = getTextContent(content[0]);
      assert.ok(text.includes('Testing 1') && text.includes('Testing 2'));
      assert.ok(text.indexOf('Testing 1') < text.indexOf('Testing 2'));
    });
  });

  it('returns correctly formatted snapshot for a simple tree', async t => {
    await withMcpContext(async (response, context) => {
      const page = context.getSelectedPptrPage();
      await page.setContent(
        html`<button>Click me</button>
          <input
            type="text"
            value="Input"
          />`,
      );
      await page.focus('button');
      response.includeSnapshot();
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      t.assert.snapshot?.(getTextContent(content[0]));
      t.assert.snapshot?.(
        JSON.stringify(stabilizeStructuredContent(structuredContent), null, 2),
      );
    });
  });

  it('returns values for textboxes', async t => {
    await withMcpContext(async (response, context) => {
      const page = context.getSelectedPptrPage();
      await page.setContent(
        html`<label
          >username<input
            name="username"
            value="mcp"
        /></label>`,
      );
      await page.focus('input');
      response.includeSnapshot();
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      assert.equal(content[0].type, 'text');
      t.assert.snapshot?.(getTextContent(content[0]));
      t.assert.snapshot?.(
        JSON.stringify(stabilizeStructuredContent(structuredContent), null, 2),
      );
    });
  });

  it('returns verbose snapshot and structured content', async t => {
    await withMcpContext(async (response, context) => {
      const page = context.getSelectedPptrPage();
      await page.setContent(html`<aside>test</aside>`);
      response.includeSnapshot({
        verbose: true,
      });
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      assert.equal(content[0].type, 'text');
      t.assert.snapshot?.(getTextContent(content[0]));
      t.assert.snapshot?.(JSON.stringify(structuredContent, null, 2));
    });
  });

  it('saves snapshot to file and returns structured content', async t => {
    const filePath = join(tmpdir(), 'test-snapshot.txt');
    try {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        await page.setContent(html`<aside>test</aside>`);
        response.includeSnapshot({
          verbose: true,
          filePath,
        });
        const {content, structuredContent} = await response.handle(
          'test',
          context,
        );
        assert.equal(content[0].type, 'text');
        t.assert.snapshot?.(
          stabilizeResponseOutput(getTextContent(content[0])),
        );
        t.assert.snapshot?.(
          JSON.stringify(
            stabilizeStructuredContent(structuredContent),
            null,
            2,
          ),
        );
      });
      const content = await readFile(filePath, 'utf-8');
      t.assert.snapshot?.(stabilizeResponseOutput(content));
    } finally {
      await rm(filePath, {force: true});
    }
  });

  it('preserves mapping ids across multiple snapshots', async () => {
    await withMcpContext(async (response, context) => {
      const page = context.getSelectedPptrPage();
      await page.setContent(html`
        <div>
          <button id="btn1">Button 1</button>
          <span id="span1">Span 1</span>
        </div>
      `);
      response.includeSnapshot();
      // First snapshot
      const res1 = await response.handle('test', context);
      const text1 = getTextContent(res1.content[0]);
      const btn1IdMatch = text1.match(/uid=(\S+) .*Button 1/);
      const span1IdMatch = text1.match(/uid=(\S+) .*Span 1/);

      assert.ok(btn1IdMatch, 'Button 1 ID not found in first snapshot');
      assert.ok(span1IdMatch, 'Span 1 ID not found in first snapshot');

      const btn1Id = btn1IdMatch[1];
      const span1Id = span1IdMatch[1];

      // Modify page: add a new element before the others to potentially shift indices if not stable
      await page.evaluate(() => {
        const newBtn = document.createElement('button');
        newBtn.textContent = 'Button 2';
        document.body.prepend(newBtn);
      });

      // Second snapshot
      const res2 = await response.handle('test', context);
      const text2 = getTextContent(res2.content[0]);

      const btn1IdMatch2 = text2.match(/uid=(\S+) .*Button 1/);
      const span1IdMatch2 = text2.match(/uid=(\S+) .*Span 1/);
      const btn2IdMatch = text2.match(/uid=(\S+) .*Button 2/);

      assert.ok(btn1IdMatch2, 'Button 1 ID not found in second snapshot');
      assert.ok(span1IdMatch2, 'Span 1 ID not found in second snapshot');
      assert.ok(btn2IdMatch, 'Button 2 ID not found in second snapshot');

      assert.strictEqual(
        btn1IdMatch2[1],
        btn1Id,
        'Button 1 ID changed between snapshots',
      );
      assert.strictEqual(
        span1IdMatch2[1],
        span1Id,
        'Span 1 ID changed between snapshots',
      );
      assert.notStrictEqual(
        btn2IdMatch[1],
        btn1Id,
        'Button 2 ID collides with Button 1',
      );
      assert.notStrictEqual(
        btn2IdMatch[1],
        btn1Id,
        'Button 2 ID collides with Button 1',
      );
    });
  });

  describe('navigation', () => {
    const server = serverHooks();

    it('resets ids after navigation', async () => {
      await withMcpContext(async (response, context) => {
        server.addHtmlRoute(
          '/page.html',
          html`
            <div>
              <button id="btn1">Button 1</button>
            </div>
          `,
        );
        const page = context.getSelectedPptrPage();
        await page.goto(server.getRoute('/page.html'));

        response.includeSnapshot();
        const res1 = await response.handle('test', context);
        const text1 = getTextContent(res1.content[0]);
        const btn1IdMatch = text1.match(/uid=(\S+) .*Button 1/);
        assert.ok(btn1IdMatch, 'Button 1 ID not found in first snapshot');
        const btn1Id = btn1IdMatch[1];

        // Navigate to the same page again (or meaningful navigation)
        await page.goto(server.getRoute('/page.html'));

        const res2 = await response.handle('test', context);
        const text2 = getTextContent(res2.content[0]);
        const btn1IdMatch2 = text2.match(/uid=(\S+) .*Button 1/);
        assert.ok(btn1IdMatch2, 'Button 1 ID not found in second snapshot');
        const btn1Id2 = btn1IdMatch2[1];

        assert.notStrictEqual(
          btn1Id2,
          btn1Id,
          'ID should reset after navigation',
        );
      });
    });
  });

  it('adds throttling setting when it is not null', async () => {
    await withMcpContext(async (response, context) => {
      await context.emulate({networkConditions: 'Slow 3G'});
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      assert.equal(content[0].type, 'text');
      const text = getTextContent(content[0]);
      assert.match(text, /Slow 3G/);
      assert.match(text, /100000\s*ms/);
      assert.deepEqual(structuredContent, {
        networkConditions: 'Slow 3G',
        navigationTimeout: 100000,
      });
    });
  });

  it('does not include throttling setting when it is null', async () => {
    await withMcpContext(async (response, context) => {
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      assert.doesNotMatch(
        getTextContent(content[0]),
        /network conditions|navigation timeout/i,
      );
      assert.deepEqual(structuredContent, {});
    });
  });
  it('adds image when image is attached', async () => {
    await withMcpContext(async (response, context) => {
      response.attachImage({data: 'imageBase64', mimeType: 'image/png'});
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );

      assert.equal(content[1].type, 'image');
      assert.strictEqual(getImageContent(content[1]).data, 'imageBase64');
      assert.strictEqual(getImageContent(content[1]).mimeType, 'image/png');
      assert.deepEqual(structuredContent, {});
    });
  });

  it('adds cpu throttling setting when it is over 1', async () => {
    await withMcpContext(async (response, context) => {
      await context.emulate({cpuThrottlingRate: 4});
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      assert.match(getTextContent(content[0]), /CPU.*4x/i);
      assert.deepEqual(structuredContent, {cpuThrottlingRate: 4});
    });
  });

  it('does not include cpu throttling setting when it is 1', async () => {
    await withMcpContext(async (response, context) => {
      await context.emulate({cpuThrottlingRate: 1});
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      assert.doesNotMatch(getTextContent(content[0]), /CPU throttling/i);
      assert.deepEqual(structuredContent, {});
    });
  });

  it('adds viewport emulation setting when it is set', async () => {
    await withMcpContext(async (response, context) => {
      await context.emulate({
        viewport: {width: 400, height: 400, deviceScaleFactor: 1},
      });
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      assert.match(getTextContent(content[0]), /"width":400/);
      assert.match(getTextContent(content[0]), /"height":400/);
      assert.deepEqual(structuredContent, {
        viewport: {
          deviceScaleFactor: 1,
          isMobile: false,
          hasTouch: false,
          isLandscape: false,
          width: 400,
          height: 400,
        },
      });
    });
  });

  it('adds userAgent emulation setting when it is set', async () => {
    await withMcpContext(async (response, context) => {
      await context.emulate({userAgent: 'MyUA'});
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      assert.match(getTextContent(content[0]), /MyUA/);
      assert.deepEqual(structuredContent, {userAgent: 'MyUA'});
    });
  });

  it('adds color scheme emulation setting when it is set', async () => {
    await withMcpContext(async (response, context) => {
      await context.emulate({colorScheme: 'dark'});
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      assert.match(getTextContent(content[0]), /color scheme.*dark/i);
      assert.deepEqual(structuredContent, {colorScheme: 'dark'});
    });
  });

  it('adds a prompt dialog', async () => {
    await withMcpContext(async (response, context) => {
      const page = context.getSelectedMcpPage();
      const dialogPromise = new Promise<void>(resolve => {
        page.pptrPage.on('dialog', () => {
          resolve();
        });
      });
      page.pptrPage.evaluate(() => {
        prompt('message', 'default');
      });
      await dialogPromise;
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      await page.getDialog()?.dismiss();
      const text = getTextContent(content[0]);
      assert.match(text, /prompt: "message"/);
      assert.match(text, /"default"/);
      assert.match(text, /page-controlled data/);
      assert.match(text, /handle_dialog/);
      assert.deepEqual(structuredContent, {
        dialog: {type: 'prompt', message: 'message', defaultValue: 'default'},
      });
    });
  });

  it('adds an alert dialog', async () => {
    await withMcpContext(async (response, context) => {
      const page = context.getSelectedMcpPage();
      const dialogPromise = new Promise<void>(resolve => {
        page.pptrPage.on('dialog', () => {
          resolve();
        });
      });
      page.pptrPage.evaluate(() => {
        alert('message');
      });
      await dialogPromise;
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      await page.getDialog()?.dismiss();
      const text = getTextContent(content[0]);
      assert.match(text, /alert: "message"/);
      assert.match(text, /page-controlled data/);
      assert.match(text, /handle_dialog/);
      assert.deepEqual(structuredContent, {
        dialog: {type: 'alert', message: 'message', defaultValue: ''},
      });
    });
  });

  it('add network requests when setting is true', async t => {
    await withMcpContext(async (response, context) => {
      response.setIncludeNetworkRequests(true);
      context.getNetworkRequests = () => {
        return [getMockRequest({stableId: 1}), getMockRequest({stableId: 2})];
      };
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      t.assert.snapshot?.(getTextContent(content[0]));
      t.assert.snapshot?.(
        JSON.stringify(stabilizeStructuredContent(structuredContent), null, 2),
      );
    });
  });

  it('does not include network requests when setting is false', async t => {
    await withMcpContext(async (response, context) => {
      response.setIncludeNetworkRequests(false);
      context.getNetworkRequests = () => {
        return [getMockRequest()];
      };
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      t.assert.snapshot?.(getTextContent(content[0]));
      t.assert.snapshot?.(
        JSON.stringify(stabilizeStructuredContent(structuredContent), null, 2),
      );
    });
  });

  it('add network request when attached with POST data', async t => {
    await withMcpContext(async (response, context) => {
      response.setIncludeNetworkRequests(true);
      const httpResponse = getMockResponse();
      httpResponse.buffer = () => {
        return Promise.resolve(Buffer.from(JSON.stringify({response: 'body'})));
      };
      httpResponse.headers = () => {
        return {
          'Content-Type': 'application/json',
        };
      };
      const request = getMockRequest({
        method: 'POST',
        hasPostData: true,
        postData: JSON.stringify({request: 'body'}),
        response: httpResponse,
      });
      context.getNetworkRequests = () => {
        return [request];
      };
      context.getNetworkRequestById = () => {
        return request;
      };
      response.attachNetworkRequest(1);

      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );

      t.assert.snapshot?.(getTextContent(content[0]));
      t.assert.snapshot?.(
        JSON.stringify(stabilizeStructuredContent(structuredContent), null, 2),
      );
    });
  });

  it('add network request when attached', async t => {
    await withMcpContext(async (response, context) => {
      response.setIncludeNetworkRequests(true);
      const request = getMockRequest();
      context.getNetworkRequests = () => {
        return [request];
      };
      context.getNetworkRequestById = () => {
        return request;
      };
      response.attachNetworkRequest(1);
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      t.assert.snapshot?.(getTextContent(content[0]));
      t.assert.snapshot?.(
        JSON.stringify(stabilizeStructuredContent(structuredContent), null, 2),
      );
    });
  });

  it('adds console messages when the setting is true', async t => {
    await withMcpContext(async (response, context) => {
      response.setIncludeConsoleData(true);
      const page = context.getSelectedPptrPage();
      const consoleMessagePromise = new Promise<void>(resolve => {
        page.on('console', () => {
          resolve();
        });
      });
      page.evaluate(() => {
        console.log('Hello from the test');
      });
      await consoleMessagePromise;
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      assert.ok(getTextContent(content[0]));
      t.assert.snapshot?.(getTextContent(content[0]));
      t.assert.snapshot?.(
        JSON.stringify(stabilizeStructuredContent(structuredContent), null, 2),
      );
    });
  });

  it('adds a message when no console messages exist', async t => {
    await withMcpContext(async (response, context) => {
      response.setIncludeConsoleData(true);
      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      assert.ok(getTextContent(content[0]));
      t.assert.snapshot?.(getTextContent(content[0]));
      t.assert.snapshot?.(
        JSON.stringify(stabilizeStructuredContent(structuredContent), null, 2),
      );
    });
  });

  it("doesn't list the issue message if mapping returns null", async t => {
    await withMcpContext(async (response, context) => {
      const mockAggregatedIssue = getMockAggregatedIssue();
      const mockDescription = {
        file: 'not-existing-description-file.md',
        links: [],
      };
      mockAggregatedIssue.getDescription.returns(mockDescription);
      response.setIncludeConsoleData(true);
      context.getConsoleData = () => {
        return [mockAggregatedIssue];
      };

      const {content, structuredContent} = await response.handle(
        'test',
        context,
      );
      const text = getTextContent(content[0]);
      assert.ok(text.includes('<no console messages found>'));
      t.assert.snapshot?.(
        JSON.stringify(stabilizeStructuredContent(structuredContent), null, 2),
      );
    });
  });

  it('throws error if mapping returns null on get issue details', async () => {
    await withMcpContext(async (response, context) => {
      const mockAggregatedIssue = getMockAggregatedIssue();
      const mockDescription = {
        file: 'not-existing-description-file.md',
        links: [],
      };
      mockAggregatedIssue.getDescription.returns(mockDescription);
      response.attachConsoleMessage(1);
      context.getConsoleMessageById = () => {
        return mockAggregatedIssue;
      };

      await assert.rejects(response.handle('test', context), /msgid 1/);
    });
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('McpResponse network request filtering', () => {
  const cases: Array<{
    name: string;
    resourceTypes?: ResourceType[];
    expectedIds: number[];
  }> = [
    {
      name: 'filters network requests by resource type',
      resourceTypes: ['script', 'stylesheet'],
      expectedIds: [1, 3],
    },
    {
      name: 'filters network requests by single resource type',
      resourceTypes: ['image'],
      expectedIds: [2],
    },
    {
      name: 'shows no requests when filter matches nothing',
      resourceTypes: ['media'],
      expectedIds: [],
    },
    {
      name: 'shows all requests when no filters are provided',
      expectedIds: [1, 2, 3, 4, 5],
    },
    {
      name: 'shows all requests when empty resourceTypes array is provided',
      resourceTypes: [],
      expectedIds: [1, 2, 3, 4, 5],
    },
  ];
  for (const testCase of cases) {
    it(testCase.name, async () => {
      await withMcpContext(async (response, context) => {
        const requests = [
          'script',
          'image',
          'stylesheet',
          'document',
          'font',
        ].map((resourceType, index) =>
          getMockRequest({
            resourceType,
            stableId: index + 1,
            url: `http://example.com/${resourceType}`,
          }),
        );
        context.getNetworkRequests = () => requests;
        response.setIncludeNetworkRequests(true, {
          resourceTypes: testCase.resourceTypes,
        });
        const {content, structuredContent} = await response.handle(
          'test',
          context,
        );
        if (testCase.expectedIds.length === 0) {
          assert.ok(!('networkRequests' in structuredContent));
        } else {
          assert.ok(
            'networkRequests' in structuredContent &&
              Array.isArray(structuredContent.networkRequests),
          );
          const ids = structuredContent.networkRequests.map(
            (request: unknown) => {
              assert.ok(isRecord(request));
              return request.requestId;
            },
          );
          assert.deepEqual(ids, testCase.expectedIds);
        }
        const text = getTextContent(content[0]);
        for (const id of [1, 2, 3, 4, 5]) {
          const pattern = new RegExp(`reqid=${id}\\b`);
          if (testCase.expectedIds.includes(id)) {
            assert.match(text, pattern);
          } else {
            assert.doesNotMatch(text, pattern);
          }
        }
      });
    });
  }
});

describe('McpResponse network pagination', () => {
  const cases: Array<{
    name: string;
    count: number;
    pageSize?: number;
    pageIdx?: number;
    expectedIds: number[];
    expectedPagination: Record<string, number | boolean>;
  }> = [
    {
      name: 'returns all requests when pagination is not provided',
      count: 5,
      expectedIds: [1, 2, 3, 4, 5],
      expectedPagination: {
        currentPage: 0,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
        startIndex: 0,
        endIndex: 5,
        invalidPage: false,
      },
    },
    {
      name: 'returns first page by default',
      count: 30,
      pageSize: 10,
      expectedIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      expectedPagination: {
        currentPage: 0,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: false,
        startIndex: 0,
        endIndex: 10,
        invalidPage: false,
      },
    },
    {
      name: 'returns subsequent page when pageIdx provided',
      count: 25,
      pageSize: 10,
      pageIdx: 1,
      expectedIds: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
      expectedPagination: {
        currentPage: 1,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
        startIndex: 10,
        endIndex: 20,
        invalidPage: false,
      },
    },
    {
      name: 'handles invalid page number by showing first page',
      count: 5,
      pageSize: 2,
      pageIdx: 10,
      expectedIds: [1, 2],
      expectedPagination: {
        currentPage: 0,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: false,
        startIndex: 0,
        endIndex: 2,
        invalidPage: true,
      },
    },
  ];
  for (const testCase of cases) {
    it(testCase.name, async () => {
      await withMcpContext(async (response, context) => {
        const requests = Array.from({length: testCase.count}, (_, index) =>
          getMockRequest({stableId: index + 1}),
        );
        context.getNetworkRequests = () => requests;
        response.setIncludeNetworkRequests(true, {
          pageSize: testCase.pageSize,
          pageIdx: testCase.pageIdx,
        });
        const {content, structuredContent} = await response.handle(
          'test',
          context,
        );
        assert.ok('pagination' in structuredContent);
        assert.deepEqual(
          structuredContent.pagination,
          testCase.expectedPagination,
        );
        assert.ok(
          'networkRequests' in structuredContent &&
            Array.isArray(structuredContent.networkRequests),
        );
        assert.deepEqual(
          structuredContent.networkRequests.map((request: unknown) => {
            assert.ok(isRecord(request));
            return request.requestId;
          }),
          testCase.expectedIds,
        );
        const text = getTextContent(content[0]);
        if (testCase.expectedPagination.hasNextPage) {
          assert.match(
            text,
            new RegExp(
              `Next page: ${Number(testCase.expectedPagination.currentPage) + 1}`,
            ),
          );
        } else {
          assert.doesNotMatch(text, /Next page:/);
        }
        if (testCase.expectedPagination.hasPreviousPage) {
          assert.match(
            text,
            new RegExp(
              `Previous page: ${Number(testCase.expectedPagination.currentPage) - 1}`,
            ),
          );
        } else {
          assert.doesNotMatch(text, /Previous page:/);
        }
        if (testCase.expectedPagination.invalidPage) {
          assert.match(text, /Invalid page/);
        }
      });
    });
  }
});

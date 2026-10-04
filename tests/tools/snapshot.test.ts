/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {describe, it} from 'node:test';

import {takeSnapshot, waitFor} from '../../src/tools/snapshot.js';
import {getTextContent, html, withMcpContext} from '../utils.js';

describe('snapshot', () => {
  describe('browser_snapshot', () => {
    it('returns accessible roles, labels and actionable UIDs', async () => {
      await withMcpContext(async (response, context) => {
        await context
          .getSelectedPptrPage()
          .setContent(html`<h1>Checkout</h1><button>Pay now</button>`);
        await takeSnapshot.handler(
          {params: {}, page: context.getSelectedMcpPage()},
          response,
          context,
        );
        const result = await response.handle('take_snapshot', context);
        const text = getTextContent(result.content[0]);
        assert.ok(text.includes('heading "Checkout"'));
        assert.ok(/uid=\d+_\d+ button "Pay now"/.test(text));
      });
    });
  });
  describe('browser_wait_for', () => {
    it('should work', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        await page.setContent(
          html`<main><span>Hello</span><span> </span><div>World</div></main>`,
        );
        await waitFor.handler(
          {
            params: {
              text: ['Hello'],
            },
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );

        const result = await response.handle('wait_for', context);
        assert.ok('snapshot' in result.structuredContent);
        assert.ok(
          JSON.stringify(result.structuredContent.snapshot).includes('Hello'),
        );
      });
    });

    it('should work with any-match array', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        await page.setContent(
          html`<main><span>Status</span><div>Error</div></main>`,
        );
        await waitFor.handler(
          {
            params: {
              text: ['Complete', 'Error'],
            },
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );

        const result = await response.handle('wait_for', context);
        assert.ok('snapshot' in result.structuredContent);
        assert.ok(
          JSON.stringify(result.structuredContent.snapshot).includes('Error'),
        );
      });
    });

    it('should work with any-match array when element shows up later', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        const handlePromise = waitFor.handler(
          {
            params: {
              text: ['Complete', 'Error'],
            },
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );

        await page.setContent(
          html`<main
            ><span>Hello</span><span> </span><div>Complete</div></main
          >`,
        );

        await handlePromise;

        const result = await response.handle('wait_for', context);
        assert.ok('snapshot' in result.structuredContent);
        assert.ok(
          JSON.stringify(result.structuredContent.snapshot).includes(
            'Complete',
          ),
        );
      });
    });

    it('should work with element that show up later', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        const handlePromise = waitFor.handler(
          {
            params: {
              text: ['Hello World'],
            },
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );

        await page.setContent(
          html`<main><span>Hello</span><span> </span><div>World</div></main>`,
        );

        await handlePromise;

        const result = await response.handle('wait_for', context);
        assert.ok('snapshot' in result.structuredContent);
        assert.ok(
          JSON.stringify(result.structuredContent.snapshot).includes('Hello'),
        );
      });
    });
    it('should work with aria elements', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        await page.setContent(
          html`<main><h1>Header</h1><div>Text</div></main>`,
        );

        await waitFor.handler(
          {
            params: {
              text: ['Header'],
            },
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );

        const result = await response.handle('wait_for', context);
        assert.ok('snapshot' in result.structuredContent);
        assert.ok(
          JSON.stringify(result.structuredContent.snapshot).includes('Header'),
        );
      });
    });

    it('should work with iframe content', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();

        await page.setContent(
          html`<h1>Top level</h1>
            <iframe srcdoc="<p>Hello iframe</p>"></iframe>`,
        );

        await waitFor.handler(
          {
            params: {
              text: ['Hello iframe'],
            },
            page: context.getSelectedMcpPage(),
          },
          response,
          context,
        );

        const result = await response.handle('wait_for', context);
        assert.ok('snapshot' in result.structuredContent);
        assert.ok(
          JSON.stringify(result.structuredContent.snapshot).includes(
            'Hello iframe',
          ),
        );
      });
    });
  });
});

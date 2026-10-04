/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';
import {promisify} from 'node:util';

import sinon from 'sinon';

import {startScreencast, stopScreencast} from '../../src/tools/screencast.js';
import {withMcpContext} from '../utils.js';

describe('screencast', () => {
  it('records a real video, refuses overlapping recordings and allows restarting', async t => {
    try {
      await promisify(execFile)('ffmpeg', ['-version']);
    } catch {
      t.skip('The real video boundary requires ffmpeg in PATH.');
      return;
    }
    const directory = await mkdtemp(
      path.join(tmpdir(), 'ghostframe-video-test-'),
    );
    try {
      await withMcpContext(async (response, context) => {
        const filePath = path.join(directory, 'recording.mp4');
        const page = context.getSelectedPptrPage();
        const request = {
          params: {filePath},
          page: context.getSelectedMcpPage(),
        };
        await page.setContent('<main>Recording</main>');
        await startScreencast().handler(request, response, context);
        response.resetResponseLineForTesting();
        await startScreencast().handler(request, response, context);
        assert.ok(
          response.responseLines.some(line =>
            line.includes('already in progress'),
          ),
        );
        await page.evaluate(async () => {
          await new Promise<void>(resolve => {
            let frame = 0;
            const animate = () => {
              document.body.style.background = frame % 2 ? 'red' : 'blue';
              if (++frame >= 20) {
                resolve();
              } else {
                requestAnimationFrame(animate);
              }
            };
            requestAnimationFrame(animate);
          });
        });
        await stopScreencast.handler(
          {params: {}, page: request.page},
          response,
          context,
        );
        const video = await readFile(filePath);
        assert.ok(video.length > 100);
        assert.strictEqual(video.toString('ascii', 4, 8), 'ftyp');
        const frame = await promisify(execFile)(
          'ffmpeg',
          [
            '-nostdin',
            '-v',
            'error',
            '-i',
            filePath,
            '-frames:v',
            '1',
            '-f',
            'image2pipe',
            '-vcodec',
            'png',
            'pipe:1',
          ],
          {encoding: null, maxBuffer: 10 * 1024 * 1024, timeout: 10_000},
        );
        assert.strictEqual(
          frame.stdout.subarray(0, 8).toString('hex'),
          '89504e470d0a1a0a',
        );
        await startScreencast().handler(
          {
            params: {filePath: path.join(directory, 'second.mp4')},
            page: request.page,
          },
          response,
          context,
        );
        await page.evaluate(async () => {
          await new Promise<void>(resolve => {
            let frame = 0;
            const animate = () => {
              document.body.style.background = frame % 2 ? 'green' : 'yellow';
              if (++frame >= 20) {
                resolve();
              } else {
                requestAnimationFrame(animate);
              }
            };
            requestAnimationFrame(animate);
          });
        });
        await stopScreencast.handler(
          {params: {}, page: request.page},
          response,
          context,
        );
        assert.ok(
          (await readFile(path.join(directory, 'second.mp4'))).length > 0,
        );
      });
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  it('turns a missing external ffmpeg executable into actionable installation guidance', async () => {
    await withMcpContext(async (response, context) => {
      const stub = sinon
        .stub(context.getSelectedPptrPage(), 'screencast')
        .rejects(new Error('spawn ffmpeg ENOENT'));
      try {
        await assert.rejects(
          startScreencast().handler(
            {params: {}, page: context.getSelectedMcpPage()},
            response,
            context,
          ),
          /ffmpeg is required.*Install ffmpeg/s,
        );
      } finally {
        stub.restore();
      }
    });
  });
});

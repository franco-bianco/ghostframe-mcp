/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import {describe, it} from 'node:test';
import {pathToFileURL} from 'node:url';

import {withMcpContext} from './utils.js';

describe('McpContext Roots', () => {
  it('should allow access to os.tmpdir() when other roots are set', async () => {
    await withMcpContext(async (_response, context) => {
      const otherRoot = path.resolve(
        os.tmpdir(),
        '..',
        'other_workspace_root_for_test',
      );
      context.setRoots([{uri: pathToFileURL(otherRoot).href, name: 'other'}]);

      const tmpPath = path.join(os.tmpdir(), 'test-file.txt');
      // This should not throw.
      await context.validatePath(tmpPath);

      // Other root should also be allowed.
      await context.validatePath(path.join(otherRoot, 'file.txt'));

      // Outside should still be denied. Use a path that is definitely not a root or temp dir.
      const outsidePath = path.resolve(
        os.homedir(),
        'a_very_unlikely_path_name_12345',
      );
      await assert.rejects(context.validatePath(outsidePath), /Access denied/);
    });
  });
});

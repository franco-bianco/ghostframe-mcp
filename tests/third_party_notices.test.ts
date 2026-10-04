/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {describe, it} from 'node:test';

const noticesPath = path.join(
  process.cwd(),
  'build/src/third_party/THIRD_PARTY_NOTICES',
);

describe('bundled dependency notices', () => {
  it(
    'includes dependency identity, licenses and available license text in the bundle artifact',
    {
      skip: fs.existsSync(noticesPath)
        ? false
        : 'npm run build does not produce notices; run npm run bundle before this packaging check.',
    },
    () => {
      const content = fs.readFileSync(noticesPath, 'utf8');
      const dependencies = content.split(
        '-------------------- DEPENDENCY DIVIDER --------------------',
      );
      assert(dependencies.length > 1);
      for (const dependency of dependencies) {
        assert.match(dependency, /^Name: \S+/m);
        assert.match(dependency, /^License:/m);
        // Rollup-generated package entries include metadata; manually collected
        // DevTools licenses contain their name and required copied license text.
        // Rollup explicitly permits missing licenseText on package metadata.
        if (/^URL:/m.test(dependency)) {
          assert.match(dependency, /^Version: \S+/m);
          assert.match(dependency, /^License: \S+/m);
        } else {
          assert.match(dependency, /copyright|permission|redistribution/i);
        }
      }
      assert.match(content, /^Name: puppeteer-core$/m);
      assert.match(content, /^Name: @modelcontextprotocol\/sdk$/m);
      assert.match(content, /Apache License\s+Version 2\.0/);
      assert.match(content, /Permission is hereby granted/);
    },
  );
});

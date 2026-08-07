/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {chromeGlobalsScript} from './chrome-globals.js';
import {nativeToStringScript} from './native-toString.js';
import {permissionsScript} from './permissions.js';

/** Builds the main-world script, with native-toString applied last. */
export function getStealthInitScript(): string {
  return [chromeGlobalsScript, permissionsScript, nativeToStringScript].join(
    '\n',
  );
}

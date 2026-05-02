/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * These polyfills are an arms-race surface; expect to maintain them as
 * detectors evolve. Patchright is the upstream we track
 * (https://github.com/Kaliiiiiiiiii-Vinyzu/patchright). Each shim here is a
 * standalone IIFE so a failure in one cannot break the others, and so the
 * native-toString shim runs last and can tag the functions installed by the
 * earlier shims.
 */

import {chromeGlobalsScript} from './chrome-globals.js';
import {nativeToStringScript} from './native-toString.js';
import {permissionsScript} from './permissions.js';
import {webglScript} from './webgl.js';

/**
 * Returns a single concatenated script string suitable for passing to
 * `Page.addScriptToEvaluateOnNewDocument` /
 * `page.evaluateOnNewDocument`.
 *
 * Order matters: chrome globals, WebGL and Permissions must run before
 * native-toString, since native-toString tags the functions those shims
 * install so that `.toString()` returns the `[native code]` shape.
 */
export function getStealthInitScript(): string {
  return [
    chromeGlobalsScript,
    permissionsScript,
    webglScript,
    nativeToStringScript,
  ].join('\n');
}

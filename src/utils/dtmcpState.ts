/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Page-side global key for in-page tool dispatch state. Stored under
 * `window[Symbol.for('dtmcp')]` rather than `window.__dtmcp` so that a simple
 * `'__dtmcp' in window` check from a detection script does not flag us. The
 * key remains discoverable via `Object.getOwnPropertySymbols(window)` but is
 * not enumerated by `Object.keys` or `for...in`.
 */
export const DTMCP_SYMBOL_KEY = 'dtmcp';

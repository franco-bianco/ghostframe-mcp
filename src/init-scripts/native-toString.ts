/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wrap `Function.prototype.toString` so that calling `.toString()` on the
 * functions installed by the other stealth shims still returns the canonical
 * `function name() { [native code] }` string. Without this wrapper the
 * polyfills are trivially detectable because their `toString()` reveals the
 * implementation source.
 *
 * Reference: Patchright's Function.prototype.toString proxy
 * (https://github.com/Kaliiiiiiiiii-Vinyzu/patchright). Reimplemented here in
 * our own words.
 */
export const nativeToStringScript = String.raw`(() => {
  try {
    const FN_TOSTRING = Function.prototype.toString;
    const NATIVE_MARKER = Symbol.for('__cdtmcp_native__');

    const isNative = (fn) => {
      try {
        return fn != null && fn[NATIVE_MARKER] === true;
      } catch (_err) {
        return false;
      }
    };

    // Tag the previously-installed shim functions so the proxy below knows to
    // mask their .toString() output. Detector code that walks the well-known
    // surface (chrome.runtime, chrome.loadTimes, chrome.csi, WebGL
    // getParameter, navigator.permissions.query) will hit the patched
    // toString and see [native code].
    const targets = [];
    try {
      const c = window.chrome;
      if (c) {
        if (typeof c.loadTimes === 'function') targets.push([c.loadTimes, 'loadTimes']);
        if (typeof c.csi === 'function') targets.push([c.csi, 'csi']);
      }
    } catch (_err) {}
    try {
      if (
        typeof WebGLRenderingContext !== 'undefined' &&
        WebGLRenderingContext.prototype.getParameter
      ) {
        targets.push([WebGLRenderingContext.prototype.getParameter, 'getParameter']);
      }
      if (
        typeof WebGL2RenderingContext !== 'undefined' &&
        WebGL2RenderingContext.prototype.getParameter
      ) {
        targets.push([WebGL2RenderingContext.prototype.getParameter, 'getParameter']);
      }
    } catch (_err) {}
    try {
      if (navigator.permissions && typeof navigator.permissions.query === 'function') {
        targets.push([navigator.permissions.query, 'query']);
      }
    } catch (_err) {}

    const nativeNameByFn = new WeakMap();
    for (const [fn, name] of targets) {
      try {
        Object.defineProperty(fn, NATIVE_MARKER, {
          value: true,
          writable: false,
          configurable: false,
          enumerable: false,
        });
      } catch (_err) {}
      nativeNameByFn.set(fn, name);
    }

    const proxiedToString = new Proxy(FN_TOSTRING, {
      apply(target, thisArg, args) {
        if (isNative(thisArg)) {
          const name = nativeNameByFn.get(thisArg) || (thisArg && thisArg.name) || '';
          return 'function ' + name + '() { [native code] }';
        }
        return Reflect.apply(target, thisArg, args);
      },
    });

    Object.defineProperty(Function.prototype, 'toString', {
      value: proxiedToString,
      writable: true,
      configurable: true,
    });
  } catch (_err) {
    // Stealth shims are best-effort; never let them break the page.
  }
})();`;

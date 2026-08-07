/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Preserves native-looking toString output for installed shims. */
export const nativeToStringScript = String.raw`(() => {
  try {
    const FN_TOSTRING = Function.prototype.toString;
    const targets = [];
    try {
      const c = window.chrome;
      if (c) {
        if (typeof c.loadTimes === 'function') targets.push([c.loadTimes, 'loadTimes']);
        if (typeof c.csi === 'function') targets.push([c.csi, 'csi']);
      }
    } catch (_err) {}
    try {
      if (navigator.permissions && typeof navigator.permissions.query === 'function') {
        targets.push([navigator.permissions.query, 'query']);
      }
    } catch (_err) {}

    const nativeNameByFn = new WeakMap();
    for (const [fn, name] of targets) {
      nativeNameByFn.set(fn, name);
    }

    const proxiedToString = new Proxy(FN_TOSTRING, {
      apply(target, thisArg, args) {
        if (typeof thisArg === 'function' && nativeNameByFn.has(thisArg)) {
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

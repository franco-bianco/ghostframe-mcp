/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Override `WebGLRenderingContext.prototype.getParameter` (and the WebGL2
 * variant) so that `UNMASKED_VENDOR_WEBGL` (37445) and
 * `UNMASKED_RENDERER_WEBGL` (37446) report a realistic GPU instead of the
 * headless defaults. Headless Chromium typically reports
 * `Google Inc. (Google)` / `ANGLE (Google, Vulkan ... SwiftShader)`, which is
 * a strong bot signal.
 *
 * Reference: Patchright's WebGL parameter spoof
 * (https://github.com/Kaliiiiiiiiii-Vinyzu/patchright). Reimplemented here in
 * our own words.
 */
export const webglScript = String.raw`(() => {
  try {
    const UNMASKED_VENDOR_WEBGL = 0x9245; // 37445
    const UNMASKED_RENDERER_WEBGL = 0x9246; // 37446
    const vendor = 'Intel Inc.';
    const renderer = 'Intel Iris OpenGL Engine';

    const patch = (proto) => {
      if (!proto || !proto.getParameter) {
        return;
      }
      const original = proto.getParameter;
      const replacement = function getParameter(name) {
        if (name === UNMASKED_VENDOR_WEBGL) {
          return vendor;
        }
        if (name === UNMASKED_RENDERER_WEBGL) {
          return renderer;
        }
        return original.call(this, name);
      };
      Object.defineProperty(proto, 'getParameter', {
        value: replacement,
        writable: true,
        configurable: true,
      });
    };

    if (typeof WebGLRenderingContext !== 'undefined') {
      patch(WebGLRenderingContext.prototype);
    }
    if (typeof WebGL2RenderingContext !== 'undefined') {
      patch(WebGL2RenderingContext.prototype);
    }
  } catch (_err) {
    // Stealth shims are best-effort; never let them break the page.
  }
})();`;

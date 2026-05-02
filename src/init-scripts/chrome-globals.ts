/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stub `window.chrome.runtime`, `window.chrome.loadTimes()`, and
 * `window.chrome.csi()` so the page looks like a regular Chrome tab rather
 * than a headless or extension-less context. The shapes mirror what the real
 * stable-channel Chrome exposes; the absence of `chrome.runtime` on a
 * non-extension page is a well-known headless tell.
 *
 * Reference: Patchright's chrome runtime / loadTimes / csi shims
 * (https://github.com/Kaliiiiiiiiii-Vinyzu/patchright). Reimplemented here in
 * our own words.
 */
export const chromeGlobalsScript = String.raw`(() => {
  try {
    const w = window;
    if (!w.chrome) {
      Object.defineProperty(w, 'chrome', {
        value: {},
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    const chrome = w.chrome;

    // --- chrome.runtime ----------------------------------------------------
    // Real Chrome exposes this object on every page (extension messaging entry
    // point). Bots that lack it advertise themselves immediately.
    if (!chrome.runtime) {
      const runtime = {
        OnInstalledReason: {
          CHROME_UPDATE: 'chrome_update',
          INSTALL: 'install',
          SHARED_MODULE_UPDATE: 'shared_module_update',
          UPDATE: 'update',
        },
        OnRestartRequiredReason: {
          APP_UPDATE: 'app_update',
          OS_UPDATE: 'os_update',
          PERIODIC: 'periodic',
        },
        PlatformArch: {
          ARM: 'arm',
          ARM64: 'arm64',
          MIPS: 'mips',
          MIPS64: 'mips64',
          X86_32: 'x86-32',
          X86_64: 'x86-64',
        },
        PlatformNaclArch: {
          ARM: 'arm',
          MIPS: 'mips',
          MIPS64: 'mips64',
          X86_32: 'x86-32',
          X86_64: 'x86-64',
        },
        PlatformOs: {
          ANDROID: 'android',
          CROS: 'cros',
          FUCHSIA: 'fuchsia',
          LINUX: 'linux',
          MAC: 'mac',
          OPENBSD: 'openbsd',
          WIN: 'win',
        },
        RequestUpdateCheckStatus: {
          NO_UPDATE: 'no_update',
          THROTTLED: 'throttled',
          UPDATE_AVAILABLE: 'update_available',
        },
      };
      Object.defineProperty(chrome, 'runtime', {
        value: runtime,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    // --- chrome.loadTimes() ------------------------------------------------
    // Deprecated but still callable in stable Chrome. Returning a plausible
    // object beats returning undefined.
    if (typeof chrome.loadTimes !== 'function') {
      const startMs = Date.now() / 1000 - Math.random() * 2;
      const loadTimes = function loadTimes() {
        return {
          requestTime: startMs,
          startLoadTime: startMs,
          commitLoadTime: startMs + 0.05,
          finishDocumentLoadTime: startMs + 0.2,
          finishLoadTime: startMs + 0.4,
          firstPaintTime: startMs + 0.3,
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: false,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2',
        };
      };
      Object.defineProperty(chrome, 'loadTimes', {
        value: loadTimes,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    // --- chrome.csi() ------------------------------------------------------
    // Same story as loadTimes(): legacy but present in real Chrome.
    if (typeof chrome.csi !== 'function') {
      const csi = function csi() {
        const now = Date.now();
        return {
          startE: now - Math.floor(Math.random() * 1000),
          onloadT: now - Math.floor(Math.random() * 200),
          pageT: Math.random() * 5000,
          tran: 15,
        };
      };
      Object.defineProperty(chrome, 'csi', {
        value: csi,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
  } catch (_err) {
    // Stealth shims are best-effort; never let them break the page.
  }
})();`;

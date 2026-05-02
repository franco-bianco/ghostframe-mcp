/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reconcile `Notification.permission` with `Permissions.query({name:
 * 'notifications'})`. In headless Chromium the former returns 'denied' while
 * the latter resolves to 'default'; that mismatch is a classic headless tell.
 *
 * Reference: Patchright's permissions reconciliation
 * (https://github.com/Kaliiiiiiiiii-Vinyzu/patchright). Reimplemented here in
 * our own words.
 */
export const permissionsScript = String.raw`(() => {
  try {
    const NotificationCtor = window.Notification;
    if (!NotificationCtor || !navigator.permissions) {
      return;
    }
    const originalQuery = navigator.permissions.query;
    if (typeof originalQuery !== 'function') {
      return;
    }
    const patched = function query(parameters) {
      try {
        if (
          parameters &&
          parameters.name === 'notifications' &&
          NotificationCtor.permission === 'denied'
        ) {
          // Mirror Notification.permission instead of returning 'default',
          // which is the headless inconsistency detectors flag.
          return Promise.resolve(
            Object.freeze({
              name: 'notifications',
              state: 'denied',
              status: 'denied',
              onchange: null,
              addEventListener() {},
              removeEventListener() {},
              dispatchEvent() {
                return false;
              },
            }),
          );
        }
      } catch (_err) {
        // fall through to the real implementation
      }
      return originalQuery.apply(this, arguments);
    };
    Object.defineProperty(navigator.permissions, 'query', {
      value: patched,
      writable: true,
      configurable: true,
    });
  } catch (_err) {
    // Stealth shims are best-effort; never let them break the page.
  }
})();`;

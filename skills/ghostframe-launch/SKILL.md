---
name: ghostframe-launch
description: Pre-flight verification for a stealth-mode browser launch. Use when starting a session against a target site that watches for bots, after changing launch flags, after switching Chrome channel, or when reusing vs creating a profile dir. Confirms the launch posture before the first sensitive navigation.
---

# Stealth launch pre-flight

A pre-flight checklist. Run before navigating to a site that uses Cloudflare, DataDome, Akamai, PerimeterX, Imperva, or Kasada — first-navigation detection is hard to recover from in the same session.

For the configuration backing each step, see [`docs/stealth-configuration.md`](~/ghostframe-mcp/docs/stealth-configuration.md).

## What this does not check

These were checks in an earlier version and are now fixed by the launch itself, so
they are not worth a round trip:

- `navigator.webdriver` is `false`, and `Navigator.prototype.webdriver` keeps its
  native getter. Both follow from the launch flags. Do not "fix" a present descriptor
  — the native accessor is correct, and replacing it with your own is the leak.
- The user agent does not say `HeadlessChrome`; the launcher rewrites it.
- `navigator.plugins` is non-empty. Headless Chrome reports the same five entries as
  headed.
- Nothing holds a second CDP session or `Debugger.enable` open. The DevTools Universe
  was removed.
- There is one launch path. Connect mode is gone, so there is no "attached to an
  existing Chrome" case to branch on.

## Workflow

### 1. Confirm persona coherence

If `emulate` has been applied:

```bash
ghostframe evaluate_script "() => ({
  ua: navigator.userAgent,
  uaCH: navigator.userAgentData?.toJSON(),
  langs: navigator.languages,
  platform: navigator.platform,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  locale: Intl.DateTimeFormat().resolvedOptions().locale
})"
```

All values must agree with the persona you set. Independently, verify the proxy egress IP's geo aligns:

```bash
ghostframe navigate_page --url "https://ipinfo.io/json"
ghostframe evaluate_script "() => document.body.innerText"
```

A timezone-IP mismatch is a stronger signal than any single attribute disagreement.

### 2. Confirm WebGL is not the software fallback

```bash
ghostframe evaluate_script "() => {
  const c = document.createElement('canvas').getContext('webgl');
  if (!c) return 'no-webgl';
  const e = c.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: c.getParameter(e.UNMASKED_VENDOR_WEBGL),
    renderer: c.getParameter(e.UNMASKED_RENDERER_WEBGL)
  };
}"
```

Bot tells:

- `vendor: 'Google Inc. (Google)'` and `renderer` containing `SwiftShader` (CPU fallback in headless without GPU).
- Both empty.

Fix: either run on a host with a real GPU (or pass-through GPU), or apply WebGL polyfills returning hardware-plausible vendor/renderer strings (see [`docs/stealth-configuration.md#dom-polyfills`](~/ghostframe-mcp/docs/stealth-configuration.md#dom-polyfills)).

## Then run a detector

Hand off to `ghostframe-detect-test` before the first sensitive navigation. Do not
inline a detector page here — that skill reads the full matrix across four detectors.

## What NOT to do

- Do not skip the detector sweep because the two checks above passed. They probe
  single attributes; a detector page integrates DOM, fingerprint and behavioral
  signals.
- Do not set `Object.defineProperty(navigator, 'webdriver', {value: false})`. The
  override is itself the signal.
- Do not run the WebGL check inside an isolated world — context creation can differ.
  Use whatever the page would see.

---
name: ghostframe-launch
description: Pre-flight verification for a stealth-mode browser launch. Use when starting a session against a target site that watches for bots, after changing launch flags, after switching Chrome channel, or when reusing vs creating a profile dir. Confirms the launch posture before the first sensitive navigation.
---

# Stealth launch pre-flight

A pre-flight checklist. Run before navigating to a site that uses Cloudflare, DataDome, Akamai, PerimeterX, Imperva, or Kasada — first-navigation detection is hard to recover from in the same session.

For the configuration backing each step, see [`docs/stealth-configuration.md`](~/ghostframe-mcp/docs/stealth-configuration.md).

## Default scope

## Workflow

### 1. Confirm launch path

```bash
ghostframe status
```

If output shows `connecting to existing Chrome`: skip step 2 (you cannot affect launch flags). Otherwise the daemon is launching its own Chrome and step 2 applies.

### 2. Confirm launch posture

Open a neutral page and inspect:

```bash
ghostframe new_page "about:blank"
ghostframe evaluate_script "() => ({
  webdriver: navigator.webdriver,
  ua: navigator.userAgent,
  pluginsLen: navigator.plugins.length,
  langs: navigator.languages
})"
```

Expected:

- `webdriver` is `false` or `undefined` (and ideally the property descriptor is absent — see step 5).
- `ua` does not contain `HeadlessChrome`.
- `pluginsLen` is non-zero on real Chrome. Zero in headless without polyfills.
- `langs` is a non-empty array matching your intended persona's locale.

If any check fails, see [`docs/troubleshooting.md`](~/ghostframe-mcp/docs/troubleshooting.md) section "Detected on first navigation".

### 3. Confirm CDP posture

The DevTools Universe was removed, so nothing attaches a second CDP session or holds
`Debugger.enable` open. Console capture rides the primary session, where puppeteer has
already enabled `Runtime` to make `evaluate_script` work at all — that enable is not
optional and is not something stealth can avoid.

A page can probe for console instrumentation that eagerly reads argument properties:

```bash
ghostframe evaluate_script "() => {
  const obj = {};
  Object.defineProperty(obj, 'foo', {
    get() { window.__leaked = true; return 'bar'; }
  });
  console.debug(obj);
  return window.__leaked;
}" --world main
```

Expected result is falsy. Passive console capture does not invoke getters; only
`get_console_message` fetches detailed argument values, and that is an explicit call
you make. If this returns `true` without you having requested detailed console data,
something is eagerly serializing console arguments — investigate before navigating to
a sensitive target.

### 4. Confirm persona coherence

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

### 5. Confirm `webdriver` descriptor is absent

```bash
ghostframe evaluate_script "() => Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver')"
```

Expected: `undefined`. If a descriptor is returned with `value: false`, the launch flag worked but the override is itself a signal — fix at launch by stripping `--enable-automation`, not by setting the value to `false` in JS.

### 6. Confirm WebGL is not the software fallback

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

### 7. Run a public detector before the target

```bash
ghostframe navigate_page --url "https://bot.sannysoft.com"
ghostframe take_screenshot --fullPage true --filePath sanny.png
ghostframe take_snapshot --filePath sanny.txt
```

If the matrix shows fails: stop. Do not navigate to the target until the matrix passes. Hand off to `ghostframe-detect-test` for the full sweep.

## Tips

- Run steps 2–6 once after launch, not before every navigation.
- If you change the persona mid-session, re-run step 4. Don't re-run steps 2 / 3 / 5 / 6 — those only change at launch.
- The detector page (step 7) is a sanity check, not a guarantee. A target site can detect what the detectors do not. If step 7 passes but the target still blocks, hand off to `ghostframe-diagnose-block`.

## What NOT to do

- Do not skip step 7 because the launch checks passed. The detector page integrates DOM, fingerprint, and behavioral signals in a way single-attribute probes do not.
- Do not paper over a `webdriver` finding by setting `Object.defineProperty(navigator, 'webdriver', { value: false })`. The override itself is the signal.
- Do not run the `WebGL` check (step 6) inside an isolated world — context creation can differ. Default to whatever the page would see.

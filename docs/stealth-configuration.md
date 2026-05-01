# Stealth Configuration

How this fork configures Chrome and CDP for stealth. Read this before launching the browser or routing scripts through `evaluate_script`.

The reference for *why* each choice matters lives in [`detection-signals.md`](./detection-signals.md).

## Browser launch

### Default flag posture

The launch routine lives at `src/browser.ts:46-134` (connect path) and `src/browser.ts:173-261` (launch path); the route is decided at `src/index.ts:191-228`.

Stripped from the inherited posture:

- `--enable-automation` — `src/browser.ts:197-198` keeps `ignoreDefaultArgs:false`, which retains this flag. Stealth mode strips it explicitly.
- Hardcoded `--screen-info={3840x2160}` at `src/browser.ts:201` — replaced with persona-coherent values from the active emulation profile.

Added in stealth mode:

- `--disable-blink-features=AutomationControlled`. Absent in the inherited launch (`src/browser.ts:193-196`); without it `navigator.webdriver === true` survives.
- Persona-aware viewport, locale, and timezone flags so launch-time values agree with what the page reads from `navigator` and `Intl`.

Kept deliberately:

- `pipe:true` at `src/browser.ts:225`. Avoids `--remote-debugging-port`, which is a CDP-detectable signal (the port shows up in `chrome://flags` and is probable from an injected script in some configurations).

### Channel selection

Default: stable Chrome via Puppeteer's resolver. Alternatives are the `chrome` channel binaries on the host. Document the channel chosen — Canary and Dev change fingerprints often and are usable but not the default.

### Profile lifecycle

`src/browser.ts:175-191` builds a predictable user-data-dir at `$HOME/.cache/chrome-devtools-mcp[-cli]/chrome-profile[-channel]`. Cookies, IndexedDB, and HSTS pins persist across runs.

For a one-shot session that should not leak prior browsing into the new run, override the user-data-dir to a fresh temp path. For a session that should look like a returning user, reuse the default.

### Headless posture

The CLI entry forces `headless: true` at `src/bin/chrome-devtools.ts:55-64,101-105`. The MCP path defaults to `headless: false` at `src/bin/chrome-devtools-mcp-cli-options.ts:90-94`. This asymmetry is real — fix in scripts you write rather than assuming a default.

Headless Chrome ships a UA containing `HeadlessChrome` and a different `navigator.userAgent`. Stealth mode requires the persona profile (see [Fingerprint coherence](#fingerprint-coherence)) to override UA when running headless. Running headless without the override is one of the most common mistakes on this fork.

### Linux DISPLAY

`src/browser.ts:155-171` reads `DISPLAY` from env. There is no Xvfb fallback, and the fork does not auto-spawn one. If headed mode on Linux returns "cannot open display", install Xvfb and run the MCP under `xvfb-run`. Out of scope for the fork to manage this.

### `--no-sandbox` posture

Permitted in containers where the host already provides isolation. Not a stealth signal in itself, but `--single-process` is — do not pair them. Some bot-detection vendors probe for the `--single-process` shape via `crossOriginIsolated`.

## CDP routing

### The Universe gate

`src/DevtoolsUtils.ts:142-156` enables `Runtime.enable` and `Debugger.enable` on every page on attach. This is the single largest CDP-detectable leak on the fork (rebrowser publishes the detection vector).

Stealth mode gates this off. The cost: DevTools-frontend Universe affordances (Universe-mediated CDP-frontend probing) become unavailable. Acceptable trade.

Two implicit `Runtime.enable` paths persist via Puppeteer's listener wiring:

- `src/PageCollector.ts:280` — `Runtime.exceptionThrown` listener.
- `src/McpContext.ts:113-122` and `src/PageCollector.ts:140` — `page.on('console'|'pageerror')` calls.

These are the next mitigation targets. Document the residual leak; do not paper over it.

### `evaluate_script` and isolated worlds

The public contract for `evaluate_script` keeps a main-world default for backwards compatibility. Stealth mode adds a `world: "isolated" | "main"` parameter, defaulting to `isolated` for agent-injected scripts.

Tools that currently leak main-world state and are migration targets:

- `src/McpPage.ts:168,265`
- `src/McpResponse.ts:105,116`
- `src/WaitForHelper.ts:37,65,76`
- `src/TextSnapshot.ts:189,204,224`
- `src/tools/script.ts:132,134`
- `src/tools/slim/tools.ts:88`
- `src/tools/pages.ts:290`

Routing rules (see [`skills/chrome-devtools/SKILL.md`](../skills/chrome-devtools/SKILL.md) for the fold-in):

1. Read-only DOM access from agent-side code: isolated.
2. Need `window.foo` set by the page: main.
3. Sets state visible to the page: main.
4. Injected by the agent rather than the user: isolated.

### `__dtmcp` global

`src/McpPage.ts:182-198` parks an internal helper at `window.__dtmcp`. A page can list it, name it, and report it. Stealth mode moves the identity to `Symbol.for('dtmcp')` so the global object's enumerable surface is unchanged.

### rebrowser-puppeteer base

User-tool eval routing uses `rebrowser-puppeteer-core` instead of stock `puppeteer-core` — see `src/third_party/index.ts:46`. This handles `Runtime.evaluate` re-routing only; the Universe gate above is a separate fix.

## Fingerprint coherence

### `emulate` bundles a persona

`src/McpContext.ts:340` (geolocation), `src/McpContext.ts:347-353` (`setUserAgent` is string-only) — the inherited tool sets values one at a time, which is the bot tell.

In stealth mode, `emulate` accepts a persona object: UA string + UA-CH metadata + `Accept-Language` + locale + timezone + geolocation + viewport. All apply atomically. Per-attribute overrides are not exposed.

Specifically:

- `setUserAgent` accepts UA-CH metadata (versions, mobile, platform, fullVersionList).
- `Emulation.setLocaleOverride` and `Emulation.setTimezoneOverride` are called as part of `emulate`.
- `setExtraHTTPHeaders` sets `Accept-Language` to match locale.
- Geolocation defaults to `clearGeolocationOverride` rather than `{0,0}` Null Island. Setting it to `{0,0}` is a known bot tell.

### Coherence checks after a persona change

After running `emulate`, evaluate the following in the page and confirm they all match the persona:

- `navigator.userAgent`
- `navigator.userAgentData` (UA-CH high-entropy values)
- `navigator.languages`
- `navigator.platform`
- `Intl.DateTimeFormat().resolvedOptions().timeZone`
- `Intl.DateTimeFormat().resolvedOptions().locale`
- The proxy egress IP's geo (verified externally; e.g. `https://ipinfo.io/json`)

A mismatch on any one is a detection.

## Humanized input

Default-on for `click`, `hover`, `type_text`, `drag`. One global off-switch only — no per-call overrides. The off-switch is for tests that need deterministic timing; it should never ship to production runs.

Distributions:

- **Mouse**: cubic-bezier path with 1–3 control-point jitters. 8–24 `mouseMoved` events along the path. 8–30 ms non-uniform inter-event gap. Optional 80–250 ms pre-press dwell. 40–180 ms down-to-up dwell.
- **Typing**: lognormal flight 80–250 ms (mean ~110 ms). Dwell 50–150 ms. Thinking pause 350–600 ms every 8–25 characters.
- **Drag**: 80–280 ms randomized inter-step. The inherited 50 ms uniform gap (`src/tools/input.ts:305-307`) is a tell.

The inherited code path has zero humanization (`src/tools/input.ts:67-69,105,141,214,272,344,434-438`). Migration is in progress; until done, treat the off-switch as default-off and verify each input tool individually.

See [`skills/humanized-input/SKILL.md`](../skills/humanized-input/SKILL.md) for the operational guide.

## DOM polyfills

Stealth mode ships Patchright-shape polyfills:

- `chrome.runtime`, `chrome.loadTimes`, `chrome.csi`
- `Notification.permission` aligned with `Permissions.query({name:'notifications'})`
- `WebGLRenderingContext.getParameter` returning sane vendor/renderer for `UNMASKED_VENDOR_WEBGL` (37445) and `UNMASKED_RENDERER_WEBGL` (37446)
- `Function.prototype.toString` Proxy preserving `function () { [native code] }` for the polyfilled functions

Read the arms-race caveat in [`detection-signals.md`](./detection-signals.md#dom-layer) before adding new polyfills.

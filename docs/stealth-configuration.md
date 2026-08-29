# Stealth Configuration

How this fork configures Chrome and CDP for stealth. Read this before launching the browser or routing scripts through `evaluate_script`.

The reference for _why_ each choice matters lives in [`detection-signals.md`](./detection-signals.md).

## Browser launch

### Default flag posture

Launch routes through `src/browser.ts:46-134` (connect path) and `src/browser.ts:215-280` (launch path); the route is decided at `src/index.ts:191-228`.

Stripped from the inherited posture:

- `--enable-automation` — added to `ignoreDefaultArgs`. This removes the automation infobar and related switches. It does not by itself change `navigator.webdriver`; measured, stripping it alone still reports `true`.
- Hardcoded `--screen-info=3840x2160` — removed entirely. Persona-coherent values come from the `emulate` tool's viewport field instead.

Added in stealth mode:

- `--disable-blink-features=AutomationControlled`. This is the flag that makes `navigator.webdriver` read `false`, so it is load-bearing rather than defence-in-depth. Chrome lists it as unsupported, which is why `--disable-infobars` is passed alongside it.

Kept deliberately:

- `pipe:true` (`src/browser.ts:314`). Avoids `--remote-debugging-port`, which is a CDP-detectable signal.

### Channel selection

Default: stable Chrome via Puppeteer's resolver. `--channel canary|dev|beta` switches binaries. Canary changes fingerprints often and is fine for ad-hoc work but not the default.

### Profile lifecycle

`src/browser.ts:222-247` builds a user-data-dir at `$HOME/.cache/ghostframe-mcp/chrome-profile[-channel]` (or `ghostframe-cli` when invoked via the CLI). Distinct from upstream `chrome-devtools-mcp`'s `$HOME/.cache/chrome-devtools-mcp/...` so this fork can coexist without contention.

Cookies, IndexedDB, localStorage, and Cloudflare reputation persist across runs. For a one-shot session that should not leak prior browsing, pass `--isolated` (or override `--user-data-dir` to a fresh temp path). For a session that should look like a returning user, reuse the default.

### Headless posture

The CLI entry forces `headless: true` at `src/bin/ghostframe.ts:55-64,101-105`. The MCP path defaults to `headless: false` at `src/bin/ghostframe-mcp-cli-options.ts`. This asymmetry is real — set it explicitly in scripts you write rather than relying on defaults.

Headless Chrome ships a UA containing `HeadlessChrome` and a different `navigator.userAgent`. Stealth mode requires a persona profile (see [Fingerprint coherence](#fingerprint-coherence)) when running headless. Running headless without the override is the most common mistake.

### Linux DISPLAY

`src/browser.ts:164-180` reads `DISPLAY` from env. There is no Xvfb fallback, and the fork does not auto-spawn one. If headed mode on Linux fails with "cannot open display", install Xvfb and run the MCP server under `xvfb-run`. Out of scope for the fork to manage.

### `--no-sandbox` posture

Permitted in containers where the host already provides isolation. Not a stealth signal in itself, but `--single-process` is — never pair them. Some bot-detection vendors probe for the `--single-process` shape via `crossOriginIsolated`.

### Authenticated proxies

HTTP proxy credentials are read from `GHOSTFRAME_PROXY_USERNAME` and `GHOSTFRAME_PROXY_PASSWORD`. Embedded credentials require `--allow-legacy-proxy-credentials`; authenticated SOCKS proxies are rejected because Chrome does not support them. See README "Proxy" for examples.

## CDP routing

### The Universe gate

`src/DevtoolsUtils.ts:55-127` defines a `UniverseManager` that, when initialised, calls `page.createCDPSession()` per page and observes `DebuggerModel` + `RuntimeModel`, which forces `Runtime.enable` and `Debugger.enable` on every page. This is the largest single CDP-detectable leak (rebrowser publishes the detection vector).

Stealth mode gates this off in `src/McpContext.ts:#init` — the Universe is not initialised when `--stealth` is on. The console / pageerror / `Runtime.exceptionThrown` listeners are also not subscribed in stealth mode, since each implicitly enables `Runtime`.

Trade-off:

- DevTools-frontend Universe affordances (CDP-frontend probing) become unavailable.
- `list_console_messages` and `get_console_message` return empty results.
- `ConsoleFormatter` falls back to its non-Universe-detailed mode.

### `evaluate_script` and isolated worlds

`evaluate_script` and slim `evaluate` accept `world: 'isolated' | 'main'`. The default is `'isolated'` — except when `args` (element UIDs) are passed, in which case the default falls back to `'main'`. Element handles are bound to the realm that created them; you cannot evaluate a main-world handle inside an isolated realm.

Routing rules:

1. Read-only DOM access from agent-side code: isolated.
2. Need `window.foo` set by the page: main.
3. Set state visible to the page: main.
4. Injected by the agent rather than the user: isolated.

Implementation: `Frame.isolatedRealm()` (Puppeteer's `@internal` API; cast through a structural type — see `src/tools/script.ts`).

### `Symbol.for('dtmcp')` global

The in-page tools state lives at `window[Symbol.for('dtmcp')]` rather than `window.__dtmcp` (`src/utils/dtmcpState.ts`). The Symbol-keyed property does not appear in `Object.keys(window)` or `for…in`, so a simple `'__dtmcp' in window` check does not flag us. It remains discoverable via `Object.getOwnPropertySymbols(window)`.

The user-facing path for calling in-page tools from `evaluate_script` is `window[Symbol.for("dtmcp")].executeTool(toolName, params)`.

### rebrowser-puppeteer (deferred)

A `rebrowser-puppeteer-core` drop-in was considered for handling user-tool eval routing through isolated worlds. Deferred: the latest rebrowser-puppeteer-core release (24.8.1, May 2025) is ~34 minor versions behind our pinned puppeteer-core (24.42.0). The Universe gate above covers the bigger detection delta and is independent. Revisit if rebrowser-puppeteer-core catches up, or via a `patch-package` approach over puppeteer-core@24.42.

## Fingerprint coherence

### `emulate` bundles a persona

The fork's `emulate` tool routes UA, UA-CH, locale, timezone, geolocation, viewport, and color-scheme through raw CDP rather than `page.setUserAgent`:

- `Emulation.setUserAgentOverride` with `userAgentMetadata` (brands, platform, mobile, bitness, fullVersionList) so `navigator.userAgent` and `Sec-CH-UA-*` stay in sync.
- `Emulation.setLocaleOverride` for `navigator.language` and `Intl` APIs.
- `Emulation.setTimezoneOverride` for `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- `Network.setExtraHTTPHeaders({'Accept-Language': locale})` so the Accept-Language header matches.
- `Emulation.clearGeolocationOverride` when no geolocation is provided (instead of `{lat:0,lon:0}` Null Island, which is itself a bot tell).

`userAgentMetadata` is exposed as a JSON-encoded string parameter (the local `enforce-zod-schema` ESLint rule forbids nested `zod.object` schemas).

### Coherence checks after a persona change

After running `emulate`, evaluate the following in the page and confirm they all match the persona:

- `navigator.userAgent`
- `navigator.userAgentData` (UA-CH high-entropy values via `getHighEntropyValues()`)
- `navigator.languages`
- `navigator.platform`
- `Intl.DateTimeFormat().resolvedOptions().timeZone`
- `Intl.DateTimeFormat().resolvedOptions().locale`
- The proxy egress IP's geo (verified externally via e.g. <https://ipinfo.io/json>)

A mismatch on any one is a detection. A US/Pacific timezone behind a Frankfurt egress IP is a stronger signal than any single value.

## Humanized input

Distributions:

- **Mouse** — cubic-bezier path with 1–3 control-point jitters, 8–24 `mouseMoved` events along the path, 8–30 ms non-uniform inter-event gap, optional 80–250 ms pre-press dwell, 40–180 ms down-to-up dwell.
- **Typing** — lognormal flight 80–250 ms (mean ~110 ms). Dwell 50–150 ms. Thinking pause 350–600 ms every 8–25 characters.
- **Drag** — 80–280 ms randomized inter-step.
- **Modifier keys** — 30–80 ms dwell.

`fill` and `fill_form` use focus, selection, clearing, and per-character typing for text controls. Native select elements retain their selection behavior.

The submit key in `type_text` uses a randomized down-to-up dwell while preserving Puppeteer's validation behavior.

Humanized input is always on and has no override; see the behavioral layer in
[`detection-signals.md`](./detection-signals.md#behavioral-layer) for the distributions.

## DOM polyfills

Stealth mode injects Patchright-shape polyfills via `Page.addScriptToEvaluateOnNewDocument` on every existing and future page (`src/browser.ts:198-220`, `src/init-scripts/`). They run in the page's main world (no `worldName`); running them in an isolated world would leave the patched APIs untouched from the perspective of detector scripts that themselves run in main world.

Shipped polyfills:

- `chrome.runtime` / `chrome.loadTimes` / `chrome.csi` stubs (`src/init-scripts/chrome-globals.ts`).
- `Notification.permission` aligned with `Permissions.query({name:'notifications'})` (`src/init-scripts/permissions.ts`).
- `Function.prototype.toString` Proxy preserving `function NAME() { [native code] }` for shim functions tracked in a private `WeakMap` (`src/init-scripts/native-toString.ts`).

WebGL is not patched. Chrome reports its actual vendor and renderer to avoid a fixed cross-device fingerprint.

Read the arms-race caveat in [`detection-signals.md#dom-layer`](./detection-signals.md#dom-layer) before adding new polyfills.

# Stealth Configuration

Ghostframe always applies its stealth launch defaults and page polyfills.
Explicit investigation tools can change runtime behavior, timing, or network routing.
Read this guide before launching Chrome or selecting an investigation tool.

The reference for _why_ each choice matters lives in [`detection-signals.md`](./detection-signals.md).

## Browser launch

### Default flag posture

The launch implementation is in [`src/browser.ts`](../src/browser.ts).
The server selects its browser configuration in [`src/index.ts`](../src/index.ts).

Stripped from the inherited posture:

- `--enable-automation` — added to `ignoreDefaultArgs`. This removes the automation infobar and related switches. It does not by itself change `navigator.webdriver`; measured, stripping it alone still reports `true`.
- Hardcoded `--screen-info=3840x2160` — removed entirely. Persona-coherent values come from the `emulate` tool's viewport field instead.

Added by default:

- `--disable-blink-features=AutomationControlled` changes the reported `navigator.webdriver` value.
  Chrome can show an unsupported-flag banner on its first tab.
  Ghostframe replaces that tab after launch.

Kept deliberately:

- `pipe: true` uses a debugging pipe instead of a TCP debugging port.
- `enableExtensions: true` permits the managed extension used for native proxy control.

### Channel selection

Default: stable Chrome via Puppeteer's resolver. `--channel canary|dev|beta` switches binaries. Canary changes fingerprints often and is fine for ad-hoc work but not the default.

### Profile lifecycle

Ghostframe stores the default profile at `$HOME/.cache/ghostframe-mcp/chrome-profile[-channel]`.
The CLI uses `ghostframe-cli` instead of `ghostframe-mcp`.
These directories differ from the upstream profile directory.

Cookies, IndexedDB, and localStorage persist when you reuse the profile.
Pass `--isolated` or select a fresh `--user-data-dir` to start without that saved browser state.

### Headless posture

The CLI defaults to headless Chrome.
The MCP server defaults to headed Chrome.
Set the option explicitly when your scripts require a particular mode.

Headless Chrome supplies a user-agent string containing `HeadlessChrome`.
Ghostframe replaces that token with `Chrome` on pages it prepares.
This replacement does not configure a complete browser persona.
Use `emulate` for the related values described under [Fingerprint coherence](#fingerprint-coherence).

### Linux DISPLAY

On Linux, Ghostframe uses `DISPLAY` or attempts to recover it from existing process environments.
It does not start an Xvfb server.
If headed Chrome cannot open a display, provide a working display or run the server under `xvfb-run`.

### `--no-sandbox` posture

Permitted in containers where the host already provides isolation. Not a stealth signal in itself, but `--single-process` is — never pair them. Some bot-detection vendors probe for the `--single-process` shape via `crossOriginIsolated`.

### Proxy configuration

Use `--proxy-server` to select an initial proxy.
Startup HTTP proxy credentials come from `GHOSTFRAME_PROXY_USERNAME` and `GHOSTFRAME_PROXY_PASSWORD`.
Embedded credentials require `--allow-legacy-proxy-credentials`.
Authenticated SOCKS proxies are unsupported.

Call `set_proxy` to change the route after Chrome launches.
Call `get_proxy` to inspect the effective regular-profile settings.
These tools initialize a managed extension when first used.
The extension changes native Chrome settings and handles matching proxy authentication challenges.
It does not terminate the destination TLS connection.

Existing connections can retain their old route.
Explicit context proxy overrides can also differ from the regular-profile route.
The tools cannot force socket migration or verify connectivity.
Chrome policy or another extension can block configuration changes.

Chrome can cache authentication for a proxy host and port.
Ghostframe rejects changed or removed credentials for a previously configured endpoint.
Use another endpoint or restart Chrome to change those credentials.
See [Change the proxy after launch](investigation.md#change-the-proxy-after-launch) for the procedure and supported connection policy.

## CDP routing

### Default page sessions

Ghostframe does not initialize the upstream DevTools-frontend Universe for every page.
That removes its additional persistent Runtime and Debugger model sessions.
Some DevTools-frontend probing and detailed formatting remain unavailable.

Puppeteer still enables Runtime on its primary page sessions.
The Universe removal does not make the browser free of Runtime instrumentation.
`ConsoleCollector` uses those existing sessions for console messages, uncaught errors, and issue reporting.
It does not enable another Runtime domain for console collection.

`list_console_messages` and `get_console_message` remain available.
They return collected data within the normal page-history retention limits.
See [`src/PageCollector.ts`](../src/PageCollector.ts) for collection and cleanup.

### Explicit investigation sessions

Passive capture starts only when you call `start_capture`.
It reuses existing primary page sessions without enabling another Runtime or Debugger domain.
Passive describes the capture mechanism; it does not guarantee invisible browser instrumentation or complete target coverage.

`get_event_listeners` and `inspect_handle` do not enable Debugger.
They can expose registered handlers and engine properties unavailable through ordinary page JavaScript.
Object retention and inspection can still affect garbage collection or timing.
`runtime_evaluate` and `call_handle` execute code and can change application state.

`debugger_control` enables Debugger only after an explicit `start` action.
Its session has a deadline and resumes execution during cleanup.
Breakpoints and debugger attachment can change runtime behavior and timing.
Do not assume that a debugger session preserves the default detection posture.

Request interception explicitly pauses selected traffic and can change request or response content.
Use `start_action` for actions that can pause.
It returns an operation ID and keeps the tool queue available for inspection and release.
See [Website and API investigation](investigation.md) for deadlines, cleanup, coverage limits, and examples.

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

A mismatch can provide a detection signal.
Check the route after a proxy change before drawing conclusions about the persona or observed exit IP.

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

Ghostframe installs its page polyfills through `Page.addScriptToEvaluateOnNewDocument` on prepared existing and future pages.
The scripts run in the main world.
An isolated-world patch would not change the APIs observed by main-world detector scripts.
See [`src/init-scripts/`](../src/init-scripts/) for the implementations.

Shipped polyfills:

- `chrome.runtime` / `chrome.loadTimes` / `chrome.csi` stubs (`src/init-scripts/chrome-globals.ts`).
- `Notification.permission` aligned with `Permissions.query({name:'notifications'})` (`src/init-scripts/permissions.ts`).
- `Function.prototype.toString` Proxy preserving `function NAME() { [native code] }` for shim functions tracked in a private `WeakMap` (`src/init-scripts/native-toString.ts`).

WebGL is not patched. Chrome reports its actual vendor and renderer to avoid a fixed cross-device fingerprint.

Read the arms-race caveat in [`detection-signals.md#dom-layer`](./detection-signals.md#dom-layer) before adding new polyfills.

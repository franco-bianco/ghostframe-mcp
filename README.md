# chrome-devtools-mcp-stealth

Private stealth fork of [`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp). Default-on stealth posture for browser automation against bot-managed sites. Coexists with the upstream package on the same machine.

Not published to npm (`"private": true` in `package.json`). Local install only.

## Differences from upstream

### Stealth mode (`--stealth`, default `true`)

When on:

- The chrome-devtools-frontend `Universe` is not initialised. The Universe forces `Runtime.enable` + `Debugger.enable` on every page, which is the largest CDP-side fingerprint and is what the `console.groupEnd` Proxy-trap family of detectors looks for.
- Page `console` / `pageerror` / `Runtime.exceptionThrown` listeners are not subscribed (those implicitly enable `Runtime`).
- Patchright-shape DOM polyfills are injected on every navigation in every page:
  - `chrome.runtime` / `chrome.loadTimes()` / `chrome.csi()` stubs.
  - `Notification.permission` ↔ `navigator.permissions.query({name:'notifications'})` coherence.
  - WebGL `UNMASKED_VENDOR_WEBGL` / `UNMASKED_RENDERER_WEBGL` spoof (`Intel Inc.` / `Intel Iris OpenGL Engine` instead of `Google Inc. (Google)` / `SwiftShader`).
  - `Function.prototype.toString` Proxy preserving `[native code]` for the polyfilled functions.
- Mouse, hover, type, key-press, and drag go through humanisers:
  - Cubic-bezier mouse paths with 8–24 `mouseMoved` events, 8–30ms non-uniform gap.
  - 40–180ms mouse-down/up dwell.
  - Lognormal keystroke flight (mean ~110ms, p10 55ms, p90 220ms), 50–150ms dwell, 350–600ms thinking pauses every 8–25 chars.
- Geolocation defaults to no override (instead of `{lat:0,lon:0}` Null Island).
- The in-page tools state global is `window[Symbol.for('dtmcp')]` instead of `window.__dtmcp`.

Trade-off: `list_console_messages` and `get_console_message` return empty under stealth, and the `ConsoleFormatter` falls back to its non-Universe-detailed mode. Pass `--no-stealth` to restore upstream behaviour.

### Chrome launch flags

- `--enable-automation` stripped from default args (zeros `navigator.webdriver`).
- `--disable-blink-features=AutomationControlled` added.
- Hardcoded `--screen-info=3840x2160` removed.
- Default user-data-dir is `~/.cache/chrome-devtools-mcp-stealth/...`, distinct from upstream's `~/.cache/chrome-devtools-mcp/...` so cookies, Cloudflare reputation, and the profile lock don't collide.
- `pipe: true` is kept (over the detectable `--remote-debugging-port`).

### Tool changes

**Added:** `set_blocked_urls` (CDP `Network.setBlockedURLs`).

**Schema additions on existing tools:**

- `evaluate_script` and slim `evaluate` accept `world: 'isolated' | 'main'`. Default is `isolated` for stealth, except when `args` (element UIDs) are passed, in which case it falls back to `main` (element handles can only be evaluated in the realm that created them).
- `emulate` accepts `userAgentMetadata` (JSON-encoded UA Client-Hints), `locale`, and `timezone`, and routes UA/locale/timezone overrides through raw CDP `Emulation.setUserAgentOverride` + `setLocaleOverride` + `setTimezoneOverride` + `Network.setExtraHTTPHeaders` so `navigator.userAgent`, `Sec-CH-UA-*`, and `Accept-Language` stay coherent.

**Removed:** `lighthouse_audit`, `take_memory_snapshot`, `load_memory_snapshot`, `get_memory_snapshot_details`, `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`. The `lighthouse` npm dep, the `chrome-devtools-frontend` heap-snapshot worker bundle, and the `trace-processing/` module are also gone. Use upstream `chrome-devtools-mcp` for these.

### Other

- `--usage-statistics` defaults to `false`. Sending stealth-config telemetry to Google's Clearcut endpoint contradicts the fork posture.
- `--proxy-server` accepts authenticated proxies — see [Proxy](#proxy).
- Package marked private; npm name is `chrome-devtools-mcp-stealth`; bin entries are `chrome-devtools-mcp-stealth` and `chrome-devtools-stealth` (so a global install never shadows upstream).

## Setup

```bash
git clone <fork-url> ~/Documents/chromedevtools-mcp-stealth
cd ~/Documents/chromedevtools-mcp-stealth
npm install
npm run build
```

Register with Claude Code (user-scoped):

```bash
claude mcp add -s user chrome-devtools-stealth -- \
  node /absolute/path/to/chromedevtools-mcp-stealth/build/src/bin/chrome-devtools-mcp.js
```

Or as JSON in your MCP client config:

```json
{
  "mcpServers": {
    "chrome-devtools-stealth": {
      "command": "node",
      "args": [
        "/absolute/path/to/chromedevtools-mcp-stealth/build/src/bin/chrome-devtools-mcp.js"
      ]
    }
  }
}
```

After pulling new commits, run `npm run build`. The MCP config does not change.

Requirements: Node.js v20.19+, Chrome stable (or another channel via `--channel`).

## Side-by-side with upstream

The fork's npm name, bin entries, and default user-data-dir are all distinct from upstream so both packages can be installed and registered with the same MCP client at once. Add both servers to your client config:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    },
    "chrome-devtools-stealth": {
      "command": "node",
      "args": [
        "/absolute/path/to/chromedevtools-mcp-stealth/build/src/bin/chrome-devtools-mcp.js"
      ]
    }
  }
}
```

Pick which to invoke per task:

- `chrome-devtools-stealth` — sites with bot management (Cloudflare, DataDome, AXS-style ticketing), anything where `navigator.webdriver=true` would block, work that benefits from clean per-session state.
- `chrome-devtools` (upstream) — Lighthouse audits, performance tracing, heap snapshots, accessibility audits, trusted local pages.

## Proxy

Proxies are off by default. Pass one with `--proxy-server`:

```text
--proxy-server=203.0.113.7:8888                         no auth
--proxy-server=203.0.113.7:8888:user:pass               with basic auth (proxy-list format)
--proxy-server=http://203.0.113.7:8888                  no auth, explicit scheme
--proxy-server=http://user:pass@203.0.113.7:8888        URL form with embedded auth
--proxy-server=socks5://proxy.example.com:1080           SOCKS5
--proxy-server=socks5://user:pass@proxy.example.com:1080 SOCKS5 with auth
```

Authenticated proxies use Puppeteer's `page.authenticate()` to answer the 407 challenge — Chrome strips inline `user:pass@` from `--proxy-server` for security, so credentials are applied at the page-event layer rather than on the command line. Authentication is registered for every existing and future page in the browser.

To bake a proxy into the global MCP config, register a separate variant alongside the default:

```bash
claude mcp add -s user chrome-devtools-stealth-proxied -- \
  node /absolute/path/to/build/src/bin/chrome-devtools-mcp.js \
  --proxy-server=203.0.113.7:8888:user:pass
```

Then you have both `chrome-devtools-stealth` (no proxy) and `chrome-devtools-stealth-proxied` registered, and pick which to invoke per task. Credential rotation requires re-running `claude mcp add`; consider this trade-off before baking creds into the config.

## Tools

<!-- BEGIN AUTO GENERATED TOOLS -->

- **Input automation** (9 tools)
  - [`click`](docs/tool-reference.md#click)
  - [`drag`](docs/tool-reference.md#drag)
  - [`fill`](docs/tool-reference.md#fill)
  - [`fill_form`](docs/tool-reference.md#fill_form)
  - [`handle_dialog`](docs/tool-reference.md#handle_dialog)
  - [`hover`](docs/tool-reference.md#hover)
  - [`press_key`](docs/tool-reference.md#press_key)
  - [`type_text`](docs/tool-reference.md#type_text)
  - [`upload_file`](docs/tool-reference.md#upload_file)
- **Navigation automation** (6 tools)
  - [`close_page`](docs/tool-reference.md#close_page)
  - [`list_pages`](docs/tool-reference.md#list_pages)
  - [`navigate_page`](docs/tool-reference.md#navigate_page)
  - [`new_page`](docs/tool-reference.md#new_page)
  - [`select_page`](docs/tool-reference.md#select_page)
  - [`wait_for`](docs/tool-reference.md#wait_for)
- **Emulation** (2 tools)
  - [`emulate`](docs/tool-reference.md#emulate)
  - [`resize_page`](docs/tool-reference.md#resize_page)
- **Network** (3 tools)
  - [`get_network_request`](docs/tool-reference.md#get_network_request)
  - [`list_network_requests`](docs/tool-reference.md#list_network_requests)
  - [`set_blocked_urls`](docs/tool-reference.md#set_blocked_urls)
- **Debugging** (5 tools)
  - [`evaluate_script`](docs/tool-reference.md#evaluate_script)
  - [`get_console_message`](docs/tool-reference.md#get_console_message)
  - [`list_console_messages`](docs/tool-reference.md#list_console_messages)
  - [`take_screenshot`](docs/tool-reference.md#take_screenshot)
  - [`take_snapshot`](docs/tool-reference.md#take_snapshot)
- **Extensions** (5 tools)
  - [`install_extension`](docs/tool-reference.md#install_extension)
  - [`list_extensions`](docs/tool-reference.md#list_extensions)
  - [`reload_extension`](docs/tool-reference.md#reload_extension)
  - [`trigger_extension_action`](docs/tool-reference.md#trigger_extension_action)
  - [`uninstall_extension`](docs/tool-reference.md#uninstall_extension)

<!-- END AUTO GENERATED TOOLS -->

Full schemas: [`docs/tool-reference.md`](./docs/tool-reference.md). Slim mode (3 tools): [`docs/slim-tool-reference.md`](./docs/slim-tool-reference.md).

## Configuration

<!-- BEGIN AUTO GENERATED OPTIONS -->

- **`--autoConnect`/ `--auto-connect`**
  If specified, automatically connects to a browser (Chrome 144+) running locally from the user data directory identified by the channel param (default channel is stable). Requires the remote debugging server to be started in the Chrome instance via chrome://inspect/#remote-debugging.
  - **Type:** boolean
  - **Default:** `false`

- **`--browserUrl`/ `--browser-url`, `-u`**
  Connect to a running, debuggable Chrome instance (e.g. `http://127.0.0.1:9222`). See README "Connecting to a running Chrome instance".
  - **Type:** string

- **`--wsEndpoint`/ `--ws-endpoint`, `-w`**
  WebSocket endpoint to connect to a running Chrome instance (e.g., `ws://127.0.0.1:9222/devtools/browser/{ID}`). Alternative to --browserUrl.
  - **Type:** string

- **`--wsHeaders`/ `--ws-headers`**
  Custom headers for WebSocket connection in JSON format (e.g., '{"Authorization":"Bearer token"}'). Only works with --wsEndpoint.
  - **Type:** string

- **`--headless`**
  Whether to run in headless (no UI) mode.
  - **Type:** boolean
  - **Default:** `false`

- **`--executablePath`/ `--executable-path`, `-e`**
  Path to custom Chrome executable.
  - **Type:** string

- **`--isolated`**
  If specified, creates a temporary user-data-dir that is automatically cleaned up after the browser is closed. Defaults to false.
  - **Type:** boolean

- **`--userDataDir`/ `--user-data-dir`**
  Path to the user data directory for Chrome. Default is $HOME/.cache/chrome-devtools-mcp-stealth/chrome-profile$CHANNEL_SUFFIX_IF_NON_STABLE.
  - **Type:** string

- **`--channel`**
  Specify a different Chrome channel that should be used. The default is the stable channel version.
  - **Type:** string
  - **Choices:** `canary`, `dev`, `beta`, `stable`

- **`--logFile`/ `--log-file`**
  Path to a file to write debug logs to. Set the env variable `DEBUG` to `*` to enable verbose logs. Useful for submitting bug reports.
  - **Type:** string

- **`--viewport`**
  Initial viewport size for the Chrome instances started by the server. For example, `1280x720`. In headless mode, max size is 3840x2160px.
  - **Type:** string

- **`--proxyServer`/ `--proxy-server`**
  Proxy server for Chrome to route all browser traffic through. Accepts: `host:port` (no auth), `host:port:user:pass` (with basic auth — common proxy-list format), `http://host:port`, `http://user:pass@host:port`, `socks5://host:port`, or `socks5://user:pass@host:port`. Authenticated proxies use Puppeteer's page.authenticate() to answer the 407 challenge — Chrome strips inline credentials from --proxy-server for security, so credentials are applied at the page-event layer, not on the command line.
  - **Type:** string

- **`--acceptInsecureCerts`/ `--accept-insecure-certs`**
  If enabled, ignores errors relative to self-signed and expired certificates. Use with caution.
  - **Type:** boolean

- **`--experimentalVision`/ `--experimental-vision`**
  Whether to enable coordinate-based tools such as click_at(x,y). Usually requires a computer-use model able to produce accurate coordinates by looking at screenshots.
  - **Type:** boolean

- **`--experimentalScreencast`/ `--experimental-screencast`**
  Exposes experimental screencast tools (requires ffmpeg). Install ffmpeg from <https://www.ffmpeg.org/download.html> and ensure it is on the MCP server PATH.
  - **Type:** boolean

- **`--experimentalFfmpegPath`/ `--experimental-ffmpeg-path`**
  Path to ffmpeg executable for screencast recording.
  - **Type:** string

- **`--experimentalWebmcp`/ `--experimental-webmcp`**
  Set to true to enable debugging WebMCP tools. Requires Chrome 149+ with the following flags: `--enable-features=WebMCPTesting,DevToolsWebMCPSupport`
  - **Type:** boolean

- **`--chromeArg`/ `--chrome-arg`**
  Additional arguments for Chrome. Only applies when Chrome is launched by chrome-devtools-mcp.
  - **Type:** array

- **`--ignoreDefaultChromeArg`/ `--ignore-default-chrome-arg`**
  Explicitly disable default arguments for Chrome. Only applies when Chrome is launched by chrome-devtools-mcp.
  - **Type:** array

- **`--categoryEmulation`/ `--category-emulation`**
  Set to false to exclude tools related to emulation.
  - **Type:** boolean
  - **Default:** `true`

- **`--categoryPerformance`/ `--category-performance`**
  Set to false to exclude tools related to performance.
  - **Type:** boolean
  - **Default:** `true`

- **`--categoryNetwork`/ `--category-network`**
  Set to false to exclude tools related to network.
  - **Type:** boolean
  - **Default:** `true`

- **`--categoryExtensions`/ `--category-extensions`**
  Set to true to include tools related to extensions. Note: This feature is currently only supported with a pipe connection. autoConnect, browserUrl, and wsEndpoint are not supported with this feature until 149 will be released.
  - **Type:** boolean
  - **Default:** `false`

- **`--stealth`**
  Stealth posture (default: true). Skips initialization of the chrome-devtools-frontend Universe (which forces Runtime.enable + Debugger.enable on every page and is the single largest CDP fingerprint) and the page console / pageerror / Runtime.exceptionThrown listeners that implicitly enable Runtime. Trade-off: list_console_messages and get_console_message return empty results, and the ConsoleFormatter degrades to its non-DevTools-detailed mode. Set to false to restore the upstream chrome-devtools-mcp behavior.
  - **Type:** boolean
  - **Default:** `true`

- **`--usageStatistics`/ `--usage-statistics`**
  Send usage statistics to Google Clearcut. Off by default in this stealth fork (sending stealth-config telemetry to Google contradicts the fork posture). Set to true to opt back in. Also disabled if `CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS` or `CI` env variables are set.
  - **Type:** boolean
  - **Default:** `false`

- **`--slim`**
  Exposes a "slim" set of 3 tools covering navigation, script execution and screenshots only. Useful for basic browser tasks.
  - **Type:** boolean

- **`--redactNetworkHeaders`/ `--redact-network-headers`**
  If true, redacts some of the network headers considered senstive before returning to the client.
  - **Type:** boolean
  - **Default:** `false`

<!-- END AUTO GENERATED OPTIONS -->

Pass options via the `args` array in the MCP JSON config. Run `node build/src/bin/chrome-devtools-mcp.js --help` to print the full list.

## Connecting to a running Chrome instance

Same as upstream — useful when you want manual and agent-driven sessions to share state, or when the agent runs inside a sandbox. Two paths:

- **`--auto-connect`** (Chrome 144+) — connect to a Chrome instance you started yourself. In Chrome, navigate to `chrome://inspect/#remote-debugging` to enable remote debugging, then start the MCP server with `--auto-connect`.
- **`--browser-url=http://127.0.0.1:9222`** — connect to a Chrome started with `--remote-debugging-port=9222`. Chrome requires a non-default `--user-data-dir` when `--remote-debugging-port` is set.

When connecting to a running Chrome, the fork does not launch its own browser, and the launch-time stealth flags (`--enable-automation` strip, polyfill injection, etc.) do not apply — the connected Chrome is whatever it was when started. The Universe gate, console-listener gate, and humanizers still apply because they live in the McpContext / tool layers.

## Limitations

- **Interactive CAPTCHAs are out of scope.** Cloudflare Turnstile, hCaptcha, reCAPTCHA Enterprise need a real user click on the widget or TLS-level fingerprint fidelity beyond what JS-side stealth can spoof. The fork passes standard Cloudflare Bot Management; sites that layer Turnstile at the actual transaction surface (e.g. AXS at `tix.axs.com`) need an external CAPTCHA solver or a real-user click.
- **JA3/JA4 + HTTP/2 frame ordering** are inherited from real Chrome via CDP. PerimeterX, Akamai Bot Manager v4, and similar can still flag the network-level fingerprint when paired with other signals.
- **DOM polyfill shape detection.** The polyfills are detectable by their shape; track Patchright as the upstream and expect maintenance churn as detectors evolve.
- **Datacenter-IP reputation.** Sites with strict reputation feeds may serve Turnstile to known datacenter IPs regardless of stealth. Use a residential or ISP-tier proxy in those cases.

## Docs and skills

- [`docs/detection-signals.md`](./docs/detection-signals.md) — six-layer detection map (CDP / launch / DOM / fingerprint / behavioral / network) with citations.
- [`docs/stealth-configuration.md`](./docs/stealth-configuration.md) — flag posture, Universe gate trade-off, isolated-world routing, persona bundling, polyfill list.
- [`docs/design-principles.md`](./docs/design-principles.md), [`docs/cli.md`](./docs/cli.md), [`docs/troubleshooting.md`](./docs/troubleshooting.md) — adapted from upstream for stealth scope.
- [`skills/stealth-launch/`](./skills/stealth-launch/) — pre-flight checklist before driving a stealth-protected site.
- [`skills/detection-testing/`](./skills/detection-testing/) — sweep workflow for `bot.sannysoft.com`, `arh.antoinevastel.com`, `creepjs`, `pixelscan`.
- [`skills/diagnose-bot-block/`](./skills/diagnose-bot-block/) — six-layer walk for "blocked but detectors pass".
- [`skills/borrow-stealth-feature/`](./skills/borrow-stealth-feature/) — port workflow for borrowing primitives from `vibheksoni/stealth-browser-mcp` and `nodriver`.
- [`skills/humanized-input/`](./skills/humanized-input/) — humanisation distributions and persona-coherence callouts.
- [`skills/chrome-devtools/`](./skills/chrome-devtools/), [`skills/chrome-devtools-cli/`](./skills/chrome-devtools-cli/), [`skills/troubleshooting/`](./skills/troubleshooting/) — adapted from upstream.

## Disclaimer

This fork exposes browser content to MCP clients. Don't share sensitive or personal information you wouldn't share with an MCP-connected agent. Intended for personal use against sites you own or have authorisation to test.

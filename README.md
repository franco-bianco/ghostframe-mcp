# ghostframe-mcp

Private stealth browser-automation MCP server. Forked from [`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp); default-on stealth posture for driving bot-managed sites. Coexists with upstream `chrome-devtools-mcp` on the same machine.

Not published to npm (`"private": true` in `package.json`). Local install only.

## Differences from upstream

### Stealth mode (`--stealth`, default `true`)

When on:

- The chrome-devtools-frontend `Universe` is not initialised. The Universe forces `Runtime.enable` + `Debugger.enable` on every page, which is the largest CDP-side fingerprint and is what the `console.groupEnd` Proxy-trap family of detectors looks for.
- Page `console` / `pageerror` / `Runtime.exceptionThrown` listeners are not subscribed (those implicitly enable `Runtime`).
- Patchright-shape DOM polyfills are injected on every navigation in every page:
  - `chrome.runtime` / `chrome.loadTimes()` / `chrome.csi()` stubs.
  - `Notification.permission` ↔ `navigator.permissions.query({name:'notifications'})` coherence.
  - `Function.prototype.toString` Proxy preserving `[native code]` for the polyfilled functions.
- WebGL remains untouched so Chrome reports the renderer it actually uses.
- Mouse, hover, fill, type, key-press, and drag go through humanisers:
  - Cubic-bezier mouse paths with 8–24 `mouseMoved` events, 8–30ms non-uniform gap.
  - 40–180ms mouse-down/up dwell.
  - Lognormal keystroke flight (mean ~110ms, p10 55ms, p90 220ms), 50–150ms dwell, 350–600ms thinking pauses every 8–25 chars.
  - `fill` and `fill_form` focus, clear, and type text per key; select elements retain native selection behavior.
  - Drag transitions use an 80–280ms randomized dwell.
- Geolocation defaults to no override (instead of `{lat:0,lon:0}` Null Island).
- The in-page tools state global is `window[Symbol.for('dtmcp')]` instead of `window.__dtmcp`.

Trade-off: `list_console_messages` and `get_console_message` return empty under stealth, and the `ConsoleFormatter` falls back to its non-Universe-detailed mode. Pass `--no-stealth` to restore upstream behaviour.

### Chrome launch flags

- `--enable-automation` stripped from default args (zeros `navigator.webdriver`).
- `--disable-blink-features=AutomationControlled` added.
- Hardcoded `--screen-info=3840x2160` removed.
- Default user-data-dir is `~/.cache/ghostframe-mcp/...`, distinct from upstream's `~/.cache/chrome-devtools-mcp/...` so cookies, Cloudflare reputation, and the profile lock don't collide.
- `pipe: true` is kept (over the detectable `--remote-debugging-port`).

### Tool changes

**Added:** `set_blocked_urls` (CDP `Network.setBlockedURLs`). Rules persist across page navigations until cleared or the page closes.

**Schema additions on existing tools:**

- `evaluate_script` and slim `evaluate` accept `world: 'isolated' | 'main'`. Default is `isolated` for stealth, except when `args` (element UIDs) are passed, in which case it falls back to `main` (element handles can only be evaluated in the realm that created them).
- `emulate` accepts `userAgentMetadata` (JSON-encoded UA Client-Hints), `locale`, and `timezone`, and routes UA/locale/timezone overrides through raw CDP `Emulation.setUserAgentOverride` + `setLocaleOverride` + `setTimezoneOverride` + `Network.setExtraHTTPHeaders` so `navigator.userAgent`, `Sec-CH-UA-*`, and `Accept-Language` stay coherent.

**Removed:** `lighthouse_audit`, `take_memory_snapshot`, `load_memory_snapshot`, `get_memory_snapshot_details`, `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`. The `lighthouse` npm dep, the `chrome-devtools-frontend` heap-snapshot worker bundle, and the `trace-processing/` module are also gone. Use upstream `chrome-devtools-mcp` for these.

### Other

- `--usage-statistics` defaults to `false`. Sending stealth-config telemetry to Google's Clearcut endpoint contradicts the fork posture.
- `--proxy-server` accepts authenticated proxies — see [Proxy](#proxy).
- File access defaults to MCP workspace roots plus the system temporary directory. `--allow-unrestricted-paths` restores the legacy unrestricted behavior.
- Package marked private; npm name is `ghostframe-mcp`; bin entries are `ghostframe-mcp` (server) and `ghostframe` (CLI). Names are distinct from upstream `chrome-devtools-mcp` / `chrome-devtools` so a global install never shadows upstream.

## Setup

```bash
git clone <fork-url> ~/Documents/ghostframe-mcp
cd ~/Documents/ghostframe-mcp
npm install
npm run build
```

Register with Claude Code (user-scoped):

```bash
claude mcp add -s user ghostframe -- \
  node /absolute/path/to/ghostframe-mcp/build/src/bin/ghostframe-mcp.js
```

Or as JSON in your MCP client config:

```json
{
  "mcpServers": {
    "ghostframe": {
      "command": "node",
      "args": [
        "/absolute/path/to/ghostframe-mcp/build/src/bin/ghostframe-mcp.js"
      ]
    }
  }
}
```

After pulling new commits, run `npm run build`. The MCP config does not change.

Requirements: Node.js v20.19+, Chrome stable (or another channel via `--channel`).

Dependabot checks npm and GitHub Actions dependencies weekly. Puppeteer, Chrome DevTools frontend, the MCP SDK, yargs, debug, and core-js are grouped separately so higher-risk upgrades are tested independently.

## Side-by-side with upstream

The fork's npm name, bin entries, and default user-data-dir are all distinct from upstream so both packages can be installed and registered with the same MCP client at once. Add both servers to your client config:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    },
    "ghostframe": {
      "command": "node",
      "args": [
        "/absolute/path/to/ghostframe-mcp/build/src/bin/ghostframe-mcp.js"
      ]
    }
  }
}
```

Pick which to invoke per task:

- `ghostframe` — sites with bot management (Cloudflare, DataDome, AXS-style ticketing), anything where `navigator.webdriver=true` would block, work that benefits from clean per-session state.
- `chrome-devtools` (upstream) — Lighthouse audits, performance tracing, heap snapshots, accessibility audits, trusted local pages.

## Proxy

Proxies are off by default. Without `--proxy-server`, Chrome uses the machine's normal network route and public IP.

Pass an unauthenticated proxy with `--proxy-server`:

```text
--proxy-server=203.0.113.7:8888
--proxy-server=http://203.0.113.7:8888
--proxy-server=socks5://proxy.example.com:1080
```

HTTP proxy authentication uses `GHOSTFRAME_PROXY_USERNAME` and `GHOSTFRAME_PROXY_PASSWORD`. Both variables are required together. Chrome does not support authenticated SOCKS proxies.

```json
{
  "mcpServers": {
    "ghostframe-proxied": {
      "command": "node",
      "args": [
        "/absolute/path/to/ghostframe-mcp/build/src/bin/ghostframe-mcp.js",
        "--proxy-server=203.0.113.7:8888"
      ],
      "env": {
        "GHOSTFRAME_PROXY_USERNAME": "user",
        "GHOSTFRAME_PROXY_PASSWORD": "pass"
      }
    }
  }
}
```

The common `IP:PORT:USER:PASS` format remains available as an explicit compatibility mode:

```bash
ghostframe start \
  --allow-legacy-proxy-credentials \
  --proxy-server=203.0.113.7:8888:user:pass
```

Legacy embedded credentials are rejected by default because process arguments can be inspected by other local processes. The Ghostframe CLI removes them from daemon arguments and transfers them through the daemon environment before starting the MCP server.

## File access

Reads and writes are limited to workspace roots supplied by the MCP client and the system temporary directory. Existing paths and the nearest existing parent of new outputs are resolved canonically, so symlinks cannot escape an allowed root. If the client supplies no roots, only the temporary directory is allowed.

Use `--allow-unrestricted-paths` only for compatibility with clients that cannot advertise roots and must access other local paths.

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
  Path to the user data directory for Chrome. Default is $HOME/.cache/ghostframe-mcp/chrome-profile$CHANNEL_SUFFIX_IF_NON_STABLE.
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
  Proxy server for Chrome. Use GHOSTFRAME_PROXY_USERNAME and GHOSTFRAME_PROXY_PASSWORD for HTTP proxy authentication. SOCKS proxies must be unauthenticated.
  - **Type:** string

- **`--allowLegacyProxyCredentials`/ `--allow-legacy-proxy-credentials`**
  Allow credentials embedded in --proxy-server. This may expose secrets through process listings and is disabled by default.
  - **Type:** boolean
  - **Default:** `false`

- **`--allowUnrestrictedPaths`/ `--allow-unrestricted-paths`**
  Allow file access outside client workspace roots and the system temporary directory. Disabled by default.
  - **Type:** boolean
  - **Default:** `false`

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
  Additional arguments for Chrome. Only applies when Chrome is launched by ghostframe-mcp.
  - **Type:** array

- **`--ignoreDefaultChromeArg`/ `--ignore-default-chrome-arg`**
  Explicitly disable default arguments for Chrome. Only applies when Chrome is launched by ghostframe-mcp.
  - **Type:** array

- **`--categoryEmulation`/ `--category-emulation`**
  Set to false to exclude tools related to emulation.
  - **Type:** boolean
  - **Default:** `true`

- **`--categoryNetwork`/ `--category-network`**
  Set to false to exclude tools related to network.
  - **Type:** boolean
  - **Default:** `true`

- **`--categoryExtensions`/ `--category-extensions`**
  Set to true to include extension tools. This requires a browser launched through the pipe connection.
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

Pass options via the `args` array in the MCP JSON config. Run `node build/src/bin/ghostframe-mcp.js --help` to print the full list.

## Connecting to a running Chrome instance

Same as upstream — useful when you want manual and agent-driven sessions to share state, or when the agent runs inside a sandbox. Two paths:

- **`--auto-connect`** (Chrome 144+) — connect to a Chrome instance you started yourself. In Chrome, navigate to `chrome://inspect/#remote-debugging` to enable remote debugging, then start the MCP server with `--auto-connect`.
- **`--browser-url=http://127.0.0.1:9222`** — connect to a Chrome started with `--remote-debugging-port=9222`. Chrome requires a non-default `--user-data-dir` when `--remote-debugging-port` is set.

When connecting to a running Chrome, the fork does not control its launch flags. Existing pages keep their existing document state; MCP-created pages receive the stealth init script before their first navigation. The Universe gate, console-listener gate, and humanizers still apply because they live in the context and tool layers.

## Docs and skills

- [`docs/detection-signals.md`](./docs/detection-signals.md) — six-layer detection map (CDP / launch / DOM / fingerprint / behavioral / network) with citations.
- [`docs/stealth-configuration.md`](./docs/stealth-configuration.md) — flag posture, Universe gate trade-off, isolated-world routing, persona bundling, polyfill list.
- [`docs/design-principles.md`](./docs/design-principles.md), [`docs/cli.md`](./docs/cli.md), [`docs/troubleshooting.md`](./docs/troubleshooting.md) — adapted from upstream for stealth scope.
- [`skills/stealth-launch/`](./skills/stealth-launch/) — pre-flight checklist before driving a stealth-protected site.
- [`skills/detection-testing/`](./skills/detection-testing/) — sweep workflow for `bot.sannysoft.com`, `arh.antoinevastel.com`, `creepjs`, `pixelscan`.
- [`skills/diagnose-bot-block/`](./skills/diagnose-bot-block/) — six-layer walk for "blocked but detectors pass".
- [`skills/borrow-stealth-feature/`](./skills/borrow-stealth-feature/) — port workflow for borrowing primitives from `vibheksoni/stealth-browser-mcp` and `nodriver`.
- [`skills/humanized-input/`](./skills/humanized-input/) — humanisation distributions and persona-coherence callouts.
- [`skills/ghostframe/`](./skills/ghostframe/), [`skills/ghostframe-cli/`](./skills/ghostframe-cli/), [`skills/troubleshooting/`](./skills/troubleshooting/) — adapted from upstream.

## Disclaimer

This fork exposes browser content to MCP clients. Don't share sensitive or personal information you wouldn't share with an MCP-connected agent. Intended for personal use against sites you own or have authorisation to test.

# ghostframe-mcp

Private stealth browser-automation MCP server. Forked from [`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp); default-on stealth posture for driving bot-managed sites. Coexists with upstream `chrome-devtools-mcp` on the same machine.

Not published to npm (`"private": true` in `package.json`). Local install only.

## Contents

- [At a glance](#at-a-glance)
- [Differences from upstream](#differences-from-upstream)
  - [Stealth mode (always on)](#stealth-mode-always-on)
  - [Chrome launch flags](#chrome-launch-flags)
  - [Tool changes](#tool-changes)
  - [Other](#other)
- [Setup](#setup)
  - [Driving it from a terminal](#driving-it-from-a-terminal)
  - [Installing the skills](#installing-the-skills)
- [Side-by-side with upstream](#side-by-side-with-upstream)
- [Proxy](#proxy)
- [File access](#file-access)
- [Tools](#tools)
- [Configuration](#configuration)
- [Docs and skills](#docs-and-skills)
- [Disclaimer](#disclaimer)

## At a glance

Measured against the last upstream commit before this fork diverged.

|                                   | `chrome-devtools-mcp`                               | `ghostframe-mcp`                                           |
| --------------------------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| Purpose                           | General browser automation and web debugging        | Driving sites that run bot management                      |
| Stealth posture                   | None                                                | Always on, no flag to disable                              |
| CLI options                       | 39                                                  | 19                                                         |
| Tool modules                      | 19                                                  | 12                                                         |
| Tools exposed                     | More, spread across category and experimental gates | 25, ungated                                                |
| DOM polyfills                     | None                                                | `chrome.runtime`, permissions coherence, native `toString` |
| Input timing                      | Immediate synthetic events                          | Bezier mouse paths, lognormal keystrokes, pointer pressure |
| Persona                           | Per-page `emulate`, does not follow new tabs        | Session-wide, reapplied to pages opened later              |
| Headless user agent               | Reports `HeadlessChrome`                            | Rewritten before the first request                         |
| Browser connection                | Launch or attach over HTTP/WebSocket                | Launch only, over a pipe                                   |
| DevTools Universe                 | Enabled; forces `Debugger.enable` per page          | Removed                                                    |
| Console capture                   | On                                                  | On                                                         |
| Network capture                   | On                                                  | On                                                         |
| Network header redaction          | Off by default                                      | On by default                                              |
| Telemetry                         | Reports to Google Clearcut                          | None                                                       |
| Lighthouse / performance / memory | Yes                                                 | No                                                         |
| Extensions, in-page tools, WebMCP | Yes                                                 | No                                                         |
| Reduced toolset (`--slim`)        | Yes                                                 | No                                                         |
| Default profile                   | `~/.cache/chrome-devtools-mcp/`                     | `~/.cache/ghostframe-mcp/`                                 |
| Published to npm                  | Yes                                                 | No, local install only                                     |

Both share the same MCP protocol, the same snapshot-and-uid interaction model, the
same puppeteer core, and the same tool names where a tool exists in both. A prompt
written for upstream generally works here, minus the removed tools.

## Differences from upstream

### Stealth mode (always on)

There is no `--stealth` flag and no way to turn stealth off. The posture is:

- Patchright-shape DOM polyfills are injected on every navigation in every page:
  - `chrome.runtime` stub (Chrome omits it on ordinary pages; its absence is a tell).
  - `chrome.loadTimes()` / `chrome.csi()` fallbacks, anchored to `performance.timeOrigin`,
    for Chrome versions that no longer ship them.
  - `Notification.permission` reconciled with `navigator.permissions.query({name:'notifications'})`.
  - `Function.prototype.toString` preserving `[native code]`, including for itself.
- Headless launches rewrite the user agent so the first request does not say
  `HeadlessChrome`.
- WebGL is untouched, so Chrome reports the renderer it actually uses.
- `navigator.webdriver` is left alone. The launch flags already make it `false`, and
  overriding it in JS would replace a native getter with a detectable one.
- Mouse, hover, fill, type, key-press and drag go through humanisers:
  - Cubic-bezier mouse paths with 8-24 `mouseMoved` events, 8-30ms non-uniform gap.
  - Press and release are dispatched at the jittered point with a real pointer
    pressure, rather than delegating to a helper that re-centres on the element.
  - Lognormal keystroke flight (mean ~110ms), 50-150ms dwell, 350-600ms thinking
    pauses every 8-25 chars.
  - Drag transitions use an 80-280ms randomized dwell.
- Geolocation defaults to no override, not `{lat:0,lon:0}`.
- A persona set with `emulate` is reapplied to pages opened later in the session, so
  two tabs in one browser cannot report different identities.

Console capture is on. It rides the primary CDP session, where puppeteer has already
enabled `Runtime` to make `evaluate_script` work at all, so it adds no detection
surface. The chrome-devtools-frontend Universe was removed — it attached a second CDP
session per page and enabled `Debugger` — so console errors no longer carry symbolized
stack traces.

### Chrome launch flags

- `--disable-blink-features=AutomationControlled` added. This is what makes
  `navigator.webdriver` read `false`; measured, stripping `--enable-automation` alone
  leaves it `true`.
- `--enable-automation` stripped from default args, which removes the automation
  infobar and the associated switches.
- `--disable-infobars` passed explicitly. Chrome treats the blink-features flag as
  unsupported and would otherwise offer to say so in a banner.
- Hardcoded `--screen-info=3840x2160` removed.
- Default user-data-dir is `~/.cache/ghostframe-mcp/...`, distinct from upstream's `~/.cache/chrome-devtools-mcp/...` so cookies, Cloudflare reputation, and the profile lock don't collide.
- `pipe: true` is kept (over the detectable `--remote-debugging-port`).

### Tool changes

**Added:** `set_blocked_urls` (CDP `Network.setBlockedURLs`). Rules persist across page navigations until cleared or the page closes.

**Schema additions on existing tools:**

- `evaluate_script` accepts `world: 'isolated' | 'main'`. Default is `isolated` for stealth, except when `args` (element UIDs) are passed, in which case it falls back to `main` (element handles can only be evaluated in the realm that created them).
- `emulate` accepts `userAgentMetadata` (JSON-encoded UA Client-Hints), `locale`, and `timezone`, and routes UA/locale/timezone overrides through raw CDP `Emulation.setUserAgentOverride` + `setLocaleOverride` + `setTimezoneOverride` + `Network.setExtraHTTPHeaders` so `navigator.userAgent`, `Sec-CH-UA-*`, and `Accept-Language` stay coherent.

**Removed:** Lighthouse, memory and performance tools; the five extension tools;
in-page tools and WebMCP; `click_at`; `get_tab_id`; and `--slim` mode. Connect mode
(`--browser-url`, `--ws-endpoint`, `--auto-connect`) is gone too — it left pre-existing
tabs unshimmed and was the only path using the WebSocket transport. The fork launches
Chrome itself over a pipe. Use upstream `chrome-devtools-mcp` for the audit tooling.

The flag surface is 19 options, down from 40. Anything that was off by default and
gated a feature has been resolved one way or the other: the feature is either always
on or gone.

### Other

- Telemetry is removed entirely. No usage statistics are collected or transmitted.
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

### Driving it from a terminal

The `ghostframe` CLI talks to the same server. Link it once:

```bash
npm link              # puts `ghostframe` and `ghostframe-mcp` on your PATH
ghostframe --help
```

Then run tools directly. The daemon and Chrome start on first use:

```bash
ghostframe new_page "https://example.com"
ghostframe take_snapshot
ghostframe click "1_4"
```

To run several browsers at once, give each its own profile directory. Chrome refuses
two instances on one profile, so this is the thing to get right:

```bash
ghostframe start --userDataDir ~/.cache/ghostframe-personas/a   # terminal 1
ghostframe start --userDataDir ~/.cache/ghostframe-personas/b   # terminal 2
```

Use `--isolated` instead if you want a throwaway profile with no persisted logins.

### Installing the skills

The skill sources are tracked in `skills/`, but Claude Code only discovers skills in
`.claude/skills/` (project) or `~/.claude/skills/` (personal). Install them to the
personal directory so they load in any session, not only when your working directory
is this repo:

```bash
cp -R skills/ghostframe-* ~/.claude/skills/
```

Verify with `/skills` in Claude Code — each should appear by name. Re-run the copy
after pulling changes to `skills/`.

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

<!-- END AUTO GENERATED TOOLS -->

Full schemas: [`docs/tool-reference.md`](./docs/tool-reference.md).

## Configuration

<!-- BEGIN AUTO GENERATED OPTIONS -->

| Option                                                                | Type                                    | Default | Description                                                                                                                                                  |
| --------------------------------------------------------------------- | --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--headless`                                                          | boolean                                 | `false` | Whether to run in headless (no UI) mode.                                                                                                                     |
| `--executablePath`<br>`--executable-path`, `-e`                       | string                                  | —       | Path to custom Chrome executable.                                                                                                                            |
| `--isolated`                                                          | boolean                                 | —       | If specified, creates a temporary user-data-dir that is automatically cleaned up after the browser is closed. Defaults to false.                             |
| `--userDataDir`<br>`--user-data-dir`                                  | string                                  | —       | Path to the user data directory for Chrome. Default is $HOME/.cache/ghostframe-mcp/chrome-profile$CHANNEL_SUFFIX_IF_NON_STABLE.                              |
| `--channel`                                                           | `canary` \| `dev` \| `beta` \| `stable` | —       | Specify a different Chrome channel that should be used. The default is the stable channel version.                                                           |
| `--logFile`<br>`--log-file`                                           | string                                  | —       | Path to a file to write debug logs to. Set the env variable `DEBUG` to `*` to enable verbose logs. Useful for submitting bug reports.                        |
| `--viewport`                                                          | string                                  | —       | Initial viewport size for the Chrome instances started by the server. For example, `1280x720`. In headless mode, max size is 3840x2160px.                    |
| `--proxyServer`<br>`--proxy-server`                                   | string                                  | —       | Proxy server for Chrome. Use GHOSTFRAME_PROXY_USERNAME and GHOSTFRAME_PROXY_PASSWORD for HTTP proxy authentication. SOCKS proxies must be unauthenticated.   |
| `--allowLegacyProxyCredentials`<br>`--allow-legacy-proxy-credentials` | boolean                                 | `false` | Allow credentials embedded in --proxy-server. This may expose secrets through process listings and is disabled by default.                                   |
| `--allowUnrestrictedPaths`<br>`--allow-unrestricted-paths`            | boolean                                 | `false` | Allow file access outside client workspace roots and the system temporary directory. Disabled by default.                                                    |
| `--acceptInsecureCerts`<br>`--accept-insecure-certs`                  | boolean                                 | —       | If enabled, ignores errors relative to self-signed and expired certificates. Use with caution.                                                               |
| `--experimentalScreencast`<br>`--experimental-screencast`             | boolean                                 | —       | Exposes experimental screencast tools (requires ffmpeg). Install ffmpeg from <https://www.ffmpeg.org/download.html> and ensure it is on the MCP server PATH. |
| `--experimentalFfmpegPath`<br>`--experimental-ffmpeg-path`            | string                                  | —       | Path to ffmpeg executable for screencast recording.                                                                                                          |
| `--chromeArg`<br>`--chrome-arg`                                       | array                                   | —       | Additional arguments for Chrome. Only applies when Chrome is launched by ghostframe-mcp.                                                                     |
| `--ignoreDefaultChromeArg`<br>`--ignore-default-chrome-arg`           | array                                   | —       | Explicitly disable default arguments for Chrome. Only applies when Chrome is launched by ghostframe-mcp.                                                     |
| `--categoryEmulation`<br>`--category-emulation`                       | boolean                                 | `true`  | Set to false to exclude tools related to emulation.                                                                                                          |
| `--categoryNetwork`<br>`--category-network`                           | boolean                                 | `true`  | Set to false to exclude tools related to network.                                                                                                            |
| `--redactNetworkHeaders`<br>`--redact-network-headers`                | boolean                                 | `true`  | If true, redacts network headers considered sensitive before returning them to the client.                                                                   |

<!-- END AUTO GENERATED OPTIONS -->

Pass options via the `args` array in the MCP JSON config. Run `node build/src/bin/ghostframe-mcp.js --help` to print the full list.

## Docs and skills

- [`docs/detection-signals.md`](./docs/detection-signals.md) — six-layer detection map (CDP / launch / DOM / fingerprint / behavioral / network) with citations.
- [`docs/stealth-configuration.md`](./docs/stealth-configuration.md) — stealth posture, isolated-world routing, persona bundling, polyfill list.
- [`docs/design-principles.md`](./docs/design-principles.md), [`docs/cli.md`](./docs/cli.md), [`docs/troubleshooting.md`](./docs/troubleshooting.md) — adapted from upstream for stealth scope.
  Sources in `skills/`, installed to `~/.claude/skills/` — see
  [Installing the skills](#installing-the-skills):

- `ghostframe-cli` — driving the browser from the terminal, world routing, personas.
- `ghostframe-detect-test` — sweep `bot.sannysoft.com`, `arh.antoinevastel.com`, `creepjs`, `pixelscan`.
- `ghostframe-diagnose-block` — six-layer walk for "blocked but detectors pass".
- `ghostframe-troubleshoot` — symptom-to-fix for failed tool calls.
- `ghostframe-borrow-feature` — porting a primitive from a reference stealth project.

## Disclaimer

This fork exposes browser content to MCP clients. Don't share sensitive or personal information you wouldn't share with an MCP-connected agent. Intended for personal use against sites you own or have authorisation to test.

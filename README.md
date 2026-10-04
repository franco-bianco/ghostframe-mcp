# ghostframe-mcp

Ghostframe lets agents inspect website flows and investigate frontend APIs.
It combines browser actions, durable traffic capture, and direct access to JavaScript runtime objects.

This private MCP server and CLI is forked from
[`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp).
It uses Chrome, Puppeteer, and the Chrome DevTools Protocol (CDP).
It does not require a Chromium fork.

The package is private and is not published to npm.
Install it from this repository.

## Contents

- [Capabilities](#capabilities)
- [Investigation workflow](#investigation-workflow)
- [Stealth behavior](#stealth-behavior)
- [Setup](#setup)
- [Terminal use](#terminal-use)
- [Proxy](#proxy)
- [File access](#file-access)
- [Tools](#tools)
- [Configuration](#configuration)
- [Documentation and skills](#documentation-and-skills)

## Capabilities

| Capability          | What the agent can do                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Browser actions     | Navigate, click, type, fill forms, upload files, and handle dialogs.                              |
| Page inspection     | Read accessibility snapshots and capture screenshots.                                             |
| Network inspection  | Inspect captured request and response headers and bodies.                                         |
| Durable capture     | Save network events and eager bodies across navigations and tab closure.                          |
| Streaming capture   | Read WebSocket and EventSource messages; request experimental fetch-stream capture.               |
| Request experiments | Pause real traffic, change a request, or replace its response.                                    |
| Runtime inspection  | Select a frame or worker, retain object handles, and inspect properties without invoking getters. |
| Event listeners     | Find listeners on an element and its ancestors. Retain actual handler functions.                  |
| Scoped debugger     | Set breakpoints, inspect paused scopes, and read generated script sources.                        |
| Browser state       | Read and change scoped cookies, including HttpOnly cookies. Inspect partitioned storage.          |
| Proxy changes       | Change the regular profile proxy after launch. Keep tabs and loaded state.                        |
| Nonblocking actions | Start an action, inspect a pause, and read its result through an operation ID.                    |

These tools expose browser facts and controls that returned text cannot reproduce.
Agents can use saved evidence to compare payloads, search downloaded sources, or write API clients.
Ghostframe does not need separate tools for those analysis steps.

See [Investigation guide](docs/investigation.md) for procedures and limits.
See [Feature priorities](docs/feature-priorities.md) for the capability ranking and remaining Chrome boundaries.

## Investigation workflow

1. Open the website with `new_page`.
2. Start a capture with `start_capture`.
3. Take a snapshot with `take_snapshot`.
4. Perform one browser action.
5. Read new events with `read_capture`.
6. Inspect the relevant request or saved body.
7. Stop the capture with `stop_capture`.

Use `arm_network_wait` before an action when you need a specific network event.
Use `start_action` when a debugger breakpoint or interception can pause that action.
It returns an operation ID so the next tool call can inspect and release the pause.

A capture records action time boundaries.
These boundaries show temporal association.
They do not prove that an action caused a request.

## Stealth behavior

Stealth defaults stay active during ordinary browser use.
Mouse paths and input timing vary.
Page initialization scripts supply Chrome API shapes and permissions coherence.
Headless launches remove `HeadlessChrome` from the initial user agent.

The browser uses a debugging pipe.
It does not use a remote debugging port.
Ghostframe removes the default automation infobar flag and uses
`--disable-blink-features=AutomationControlled`.

The upstream DevTools Universe is not enabled.
Passive capture uses the existing page CDP session.
A debugger session starts only after an explicit `debugger_control` call.

Debugger pauses and request interception change execution timing.
Runtime inspection and proxy control also add browser activity.
Stealth defaults do not make these operations invisible.

Chrome supplies the website-facing TLS and HTTP stack.
Native proxy control does not terminate destination TLS.
WebGL reports the actual renderer.
The `emulate` tool applies persona settings to pages opened later in the session.

Lighthouse, performance tracing, and heap snapshots remain outside this fork.
Telemetry is removed.
The default profile path is separate from upstream.

## Setup

Requirements: Node.js v20.19 or later and Chrome.
Use `--channel` to select another installed Chrome channel.

```bash
git clone <fork-url> ~/Documents/ghostframe-mcp
cd ~/Documents/ghostframe-mcp
npm install
npm run build
```

Register the server in your MCP client:

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

For Claude Code:

```bash
claude mcp add -s user ghostframe -- \
  node /absolute/path/to/ghostframe-mcp/build/src/bin/ghostframe-mcp.js
```

Run `npm run build` after source changes.
The server path in your client configuration stays the same.

## Terminal use

The `ghostframe` CLI uses the same server tools.
Its daemon and Chrome start on first use.

```bash
npm link
ghostframe --help
ghostframe new_page "https://example.com"
ghostframe take_snapshot
ghostframe click "1_4"
```

Use separate profile directories for concurrent browsers:

```bash
ghostframe start --sessionId a --userDataDir ~/.cache/ghostframe-personas/a
ghostframe start --sessionId b --userDataDir ~/.cache/ghostframe-personas/b
```

Chrome permits one browser process per profile directory.
The CLI uses a temporary profile by default.
Use distinct `--sessionId` values to address concurrent daemons.

Ghostframe and upstream can run side by side.
Their executable names and default profile directories differ.

## Proxy

Call `set_proxy` after launch to select a proxy.
Call `get_proxy` to inspect the effective regular profile settings.
These calls do not restart Chrome.

```json
{
  "mode": "proxy",
  "server": "http://proxy.example.com:8888",
  "username": "user",
  "password": "pass",
  "connectionPolicy": "new_connections"
}
```

Return to direct access with:

```json
{"mode": "direct"}
```

Proxy control uses a managed Chrome extension and the native Chrome proxy settings.
It applies to the regular profile.
Isolated contexts with explicit proxy overrides can use another route.

Existing tunnels, requests, and sockets can keep their previous route.
The tool does not migrate them.
`disconnect_existing` is rejected.
A proxy change does not verify connectivity or change UDP and WebRTC routing.

Chrome can cache proxy authentication.
Ghostframe rejects changed or removed credentials for a previously configured host and port.
Use another endpoint or restart Chrome for that change.
Authenticated SOCKS proxies are not supported.

You can still select a proxy at launch:

```text
--proxy-server=http://proxy.example.com:8888
--proxy-server=socks5://proxy.example.com:1080
```

For launch-time HTTP authentication, set both
`GHOSTFRAME_PROXY_USERNAME` and `GHOSTFRAME_PROXY_PASSWORD`.
Legacy embedded credentials require `--allow-legacy-proxy-credentials`.

## File access

Tool file paths are limited to client workspace roots and the system temporary directory.
If the client supplies no roots, only temporary paths are allowed.
Path validation resolves existing paths and the nearest existing parent.
Symlinks cannot bypass the allowed roots.

Use `--allow-unrestricted-paths` when your client cannot supply roots and requires other paths.

Network inspection, capture, and interception return collected header values in full.
This includes authentication, cookie, and custom headers.
Captured bodies are saved unchanged.
They can contain session tokens or other application data.

Capture files use decoded CDP bodies and normalized header representations.
They are not wire recordings.
Some bodies, headers, frames, and targets can be unavailable.
The capture journal records known gaps and byte limits.

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
- **Network** (13 tools)
  - [`arm_interception`](docs/tool-reference.md#arm_interception)
  - [`arm_network_wait`](docs/tool-reference.md#arm_network_wait)
  - [`get_network_request`](docs/tool-reference.md#get_network_request)
  - [`get_proxy`](docs/tool-reference.md#get_proxy)
  - [`list_network_requests`](docs/tool-reference.md#list_network_requests)
  - [`read_capture`](docs/tool-reference.md#read_capture)
  - [`read_interception`](docs/tool-reference.md#read_interception)
  - [`read_network_wait`](docs/tool-reference.md#read_network_wait)
  - [`resolve_interception`](docs/tool-reference.md#resolve_interception)
  - [`set_blocked_urls`](docs/tool-reference.md#set_blocked_urls)
  - [`set_proxy`](docs/tool-reference.md#set_proxy)
  - [`start_capture`](docs/tool-reference.md#start_capture)
  - [`stop_capture`](docs/tool-reference.md#stop_capture)
- **Debugging** (17 tools)
  - [`call_handle`](docs/tool-reference.md#call_handle)
  - [`cancel_operation`](docs/tool-reference.md#cancel_operation)
  - [`debugger_control`](docs/tool-reference.md#debugger_control)
  - [`evaluate_script`](docs/tool-reference.md#evaluate_script)
  - [`get_console_message`](docs/tool-reference.md#get_console_message)
  - [`get_event_listeners`](docs/tool-reference.md#get_event_listeners)
  - [`get_operation`](docs/tool-reference.md#get_operation)
  - [`inspect_handle`](docs/tool-reference.md#inspect_handle)
  - [`inspect_storage`](docs/tool-reference.md#inspect_storage)
  - [`list_console_messages`](docs/tool-reference.md#list_console_messages)
  - [`list_targets`](docs/tool-reference.md#list_targets)
  - [`release_handles`](docs/tool-reference.md#release_handles)
  - [`runtime_evaluate`](docs/tool-reference.md#runtime_evaluate)
  - [`session_cookies`](docs/tool-reference.md#session_cookies)
  - [`start_action`](docs/tool-reference.md#start_action)
  - [`take_screenshot`](docs/tool-reference.md#take_screenshot)
  - [`take_snapshot`](docs/tool-reference.md#take_snapshot)

<!-- END AUTO GENERATED TOOLS -->

Full tool schemas are in [Tool reference](docs/tool-reference.md).

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

<!-- END AUTO GENERATED OPTIONS -->

## Documentation and skills

Follow [the documentation guidelines](docs/documentation-guidelines.md) and [the testing policy](docs/testing-policy.md) for repository changes.
The [test audit](docs/testing-audit.md) records the current cleanup and the behaviors that retained checks protect.

- [Investigation guide](docs/investigation.md): procedures for capture, proxy changes, runtime access, and controlled experiments.
- [Tool reference](docs/tool-reference.md): generated schemas for all tools.
- [Design principles](docs/design-principles.md): implementation rules and investigation tradeoffs.
- [Documentation guidelines](docs/documentation-guidelines.md): writing rules for this repository.
- [Stealth configuration](docs/stealth-configuration.md): browser configuration details.
- [Detection signals](docs/detection-signals.md): known detection layers.
- [Troubleshooting](docs/troubleshooting.md): setup and browser failures.

Skill sources are in `skills/`.
To install them for Claude Code:

```bash
cp -R skills/ghostframe-* ~/.claude/skills/
```

Copy them again after skill changes.

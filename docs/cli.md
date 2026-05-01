# Chrome DevTools CLI

Experimental CLI client for the MCP server. Useful for ad-hoc browser driving, scripting stealth probes, or having an agent generate shell scripts that automate browser actions.

## Getting started

Install the package globally:

```sh
npm i chrome-devtools-mcp@latest -g
chrome-devtools status
```

## How it works

The CLI connects to a background MCP daemon (Unix socket on Linux/Mac, named pipe on Windows).

- **Implicit start**: the first tool call starts the daemon and Chrome if needed.
- **State persistence**: subsequent commands hit the same browser instance, preserving cookies, profile state, and open pages.
- **Manual control**: `start`, `stop`, `status`. `start` forwards args to the MCP server; not all server args are supported in CLI form (`chrome-devtools start --help`).

Headless is the CLI default. The MCP path defaults to headed — see [`stealth-configuration.md`](./stealth-configuration.md#headless-posture) for why this matters.

```sh
chrome-devtools status
chrome-devtools navigate_page "https://example.com"
chrome-devtools take_screenshot --filePath screenshot.png
chrome-devtools stop
```

## Stealth-relevant flags

Pass to `chrome-devtools start`. Names and exact wiring evolve; check `--help` against the version you have installed.

- **Profile lifecycle**. `--userDataDir <path>` reuses or creates a Chrome profile dir. Without it, isolated mode is implied — a fresh profile per session. Cookies, IndexedDB, and HSTS pins persist when the dir is reused. See [`stealth-configuration.md#profile-lifecycle`](./stealth-configuration.md#profile-lifecycle).
- **Channel selection**. `--channel <stable|beta|canary>` picks the Chrome binary. Default is stable. Canary changes fingerprints often.
- **Headless**. `--headless` / `--headed`. Headless ships `HeadlessChrome` in the UA unless persona override is in effect.
- **Connect to running Chrome**. `--browserUrl http://127.0.0.1:9222` or `--wsEndpoint ws://...` to skip the launch path entirely. Use this when the launch flags are out of your control (sandboxed clients) or when you want to drive your own Chrome instance.
- **Auto-connect**. `--autoConnect` discovers a running Chrome via its `DevToolsActivePort` file. Requires Chrome 144+ already running with remote debugging enabled.

The full server flag surface is documented in `npx chrome-devtools-mcp@latest --help`. The CLI exposes a filtered subset (see `src/bin/chrome-devtools.ts`).

## Command usage

```sh
chrome-devtools <tool> [arguments] [flags]
```

- Required arguments: positional.
- Optional arguments: flags (`--filePath`, `--fullPage`, etc.).

Tools that take additional arguments beyond simple types are not yet exposed in the CLI (see `--categoryExtensions`).

### Examples

Navigation:

```sh
chrome-devtools new_page "https://example.com"
chrome-devtools navigate_page "https://example.com" --type url
```

Interaction (UID from `take_snapshot`):

```sh
chrome-devtools click "1_4"
chrome-devtools fill "1_8" "search query"
chrome-devtools type_text "hello world"
```

Detection probe:

```sh
chrome-devtools new_page "https://bot.sannysoft.com"
chrome-devtools take_screenshot --filePath sannysoft.png
chrome-devtools take_snapshot --filePath sannysoft.txt
```

See [`skills/detection-testing/SKILL.md`](../skills/detection-testing/SKILL.md) for the full probe workflow.

## Output format

Default: human-readable Markdown. JSON via flag:

```sh
chrome-devtools list_pages --output-format=json
```

## Troubleshooting

If the CLI hangs or fails to connect:

```sh
chrome-devtools stop
```

For verbose logs:

```sh
DEBUG=* chrome-devtools list_pages
```

See [`troubleshooting.md`](./troubleshooting.md) for stealth-specific failures (CDP-detected on first navigation, isolated-world eval not picking up changes, persona incoherence).

## CLI generation

`scripts/generate-cli.ts` generates the CLI surface from tool metadata. Some tools are excluded from generation (`wait_for`, `fill_form`). Server args that do not make sense in a CLI are filtered in `src/bin/chrome-devtools.ts`.

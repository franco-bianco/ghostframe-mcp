# Stealth CLI

Experimental CLI client for the MCP server. Useful for ad-hoc browser driving, scripting stealth probes, or having an agent generate shell scripts that automate browser actions.

The fork is private (not on npm). The CLI is invoked from the local build:

```sh
node /absolute/path/to/chromedevtools-mcp-stealth/build/src/bin/chrome-devtools.js status
```

If you want a shorter command, alias it in your shell rc:

```sh
alias cdms='node /absolute/path/to/chromedevtools-mcp-stealth/build/src/bin/chrome-devtools.js'
cdms status
```

Or `npm link` from the repo to install `chrome-devtools-mcp-stealth` and `chrome-devtools-stealth` on `PATH` for the current user (these names will not collide with upstream `chrome-devtools-mcp` / `chrome-devtools`).

## How it works

The CLI connects to a background MCP daemon (Unix socket on Linux/Mac, named pipe on Windows).

- **Implicit start** — the first tool call starts the daemon and Chrome if needed.
- **State persistence** — subsequent commands hit the same browser instance, preserving cookies, profile state, and open pages.
- **Manual control** — `start`, `stop`, `status`. `start` forwards args to the MCP server; not all server args are supported in CLI form (`<cmd> start --help`).

Headless is the CLI default. The MCP path defaults to headed — see [`stealth-configuration.md#headless-posture`](./stealth-configuration.md#headless-posture) for why this matters.

```sh
cdms status
cdms navigate_page "https://example.com"
cdms take_screenshot --filePath screenshot.png
cdms stop
```

## Stealth-relevant flags

Pass to `<cmd> start`. Names and exact wiring evolve; check `--help` against the build you have.

- **Stealth posture** — `--stealth` (default `true` in this fork). `--no-stealth` disables the Universe gate, polyfills, and humanizers; useful as a diagnostic when something breaks mysteriously.
- **Profile lifecycle** — `--user-data-dir <path>` reuses or creates a Chrome profile dir. Default is `$HOME/.cache/chrome-devtools-mcp-stealth/chrome-profile[-channel]`. `--isolated` uses a temp dir, cleared at session end. See [`stealth-configuration.md#profile-lifecycle`](./stealth-configuration.md#profile-lifecycle).
- **Channel** — `--channel <stable|beta|canary|dev>`. Default stable. Canary changes fingerprints often.
- **Headless** — `--headless` / `--headed`. Headless ships `HeadlessChrome` in the UA unless an `emulate` persona override is in effect.
- **Proxy** — `--proxy-server` accepts `host:port`, `host:port:user:pass`, `http://user:pass@host:port`, `socks5://...`. See README "Proxy".
- **Connect to running Chrome** — `--browser-url http://127.0.0.1:9222` or `--ws-endpoint ws://...` to skip the launch path entirely. Stealth launch flags do not apply to a connected Chrome — only the CDP-side stealth (Universe gate, console listeners, humanizer) applies.
- **Auto-connect** — `--auto-connect` discovers a running Chrome via its `DevToolsActivePort` file. Requires Chrome 144+ already running with remote debugging enabled.

The full server flag surface is documented in `<cmd> --help`. The CLI subcommand exposes a filtered subset (see `src/bin/chrome-devtools.ts`).

## Command usage

```sh
<cmd> <tool> [arguments] [flags]
```

- Required arguments: positional.
- Optional arguments: flags (`--filePath`, `--fullPage`, etc.).

Tools that take complex arguments are not exposed in the CLI (see `--category-extensions`).

### Examples

Navigation:

```sh
cdms new_page "https://example.com"
cdms navigate_page "https://example.com" --type url
```

Interaction (UID from `take_snapshot`):

```sh
cdms click "1_4"
cdms fill "1_8" "search query"
cdms type_text "hello world"
```

Detection probe:

```sh
cdms new_page "https://bot.sannysoft.com"
cdms take_screenshot --filePath sannysoft.png
cdms take_snapshot --filePath sannysoft.txt
```

Through a proxy:

```sh
cdms start --proxy-server=203.0.113.7:8888:user:pass
cdms new_page "https://api.ipify.org/?format=json"
cdms evaluate_script '() => document.body.innerText'
```

See [`skills/detection-testing/SKILL.md`](../skills/detection-testing/SKILL.md) for the full probe workflow.

## Output format

Default: human-readable Markdown. JSON via flag:

```sh
cdms list_pages --output-format=json
```

## Troubleshooting

If the CLI hangs or fails to connect:

```sh
cdms stop
```

For verbose logs:

```sh
DEBUG=* cdms list_pages
```

See [`troubleshooting.md`](./troubleshooting.md) for stealth-specific failures.

## CLI generation

`scripts/generate-cli.ts` generates the CLI surface from tool metadata. Some tools are excluded from generation (`wait_for`, `fill_form`). Server args that do not make sense in a CLI are filtered in `src/bin/chrome-devtools.ts`. Re-run `npm run cli:generate` after schema or option changes.

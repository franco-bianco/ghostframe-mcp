# Stealth CLI

Experimental CLI client for the MCP server. Useful for ad-hoc browser driving, scripting stealth probes, or having an agent generate shell scripts that automate browser actions.

The fork is private (not on npm). The CLI is invoked from the local build:

```sh
node /absolute/path/to/ghostframe-mcp/build/src/bin/ghostframe.js status
```

If you want a shorter command, alias it in your shell rc:

```sh
alias gf='node /absolute/path/to/ghostframe-mcp/build/src/bin/ghostframe.js'
gf status
```

Or `npm link` from the repo to install `ghostframe-mcp` (server) and `ghostframe` (CLI) on `PATH` for the current user (these names will not collide with upstream `chrome-devtools-mcp` / `chrome-devtools`).

## How it works

The CLI connects to a background MCP daemon (Unix socket on Linux/Mac, named pipe on Windows).

- **Implicit start** — the first tool call starts the daemon and Chrome if needed.
- **State persistence** — subsequent commands hit the same browser instance, preserving cookies, profile state, and open pages.
- **Manual control** — `start`, `stop`, `status`. `start` forwards args to the MCP server; not all server args are supported in CLI form (`<cmd> start --help`).

Headless is the CLI default. The MCP path defaults to headed — see [`stealth-configuration.md#headless-posture`](./stealth-configuration.md#headless-posture) for why this matters.

```sh
gf status
gf navigate_page "https://example.com"
gf take_screenshot --filePath screenshot.png
gf stop
```

## Stealth-relevant flags

Pass to `<cmd> start`. Names and exact wiring evolve; check `--help` against the build you have.

- **Profile lifecycle** — `--user-data-dir <path>` reuses or creates a Chrome profile dir. Default is `$HOME/.cache/ghostframe-cli/chrome-profile[-channel]` for the CLI path, `$HOME/.cache/ghostframe-mcp/...` for the MCP server. `--isolated` uses a temp dir, cleared at session end. See [`stealth-configuration.md#profile-lifecycle`](./stealth-configuration.md#profile-lifecycle).
- **Channel** — `--channel <stable|beta|canary|dev>`. Default stable. Canary changes fingerprints often.
- **Proxy** — `--proxy-server` accepts HTTP and unauthenticated SOCKS endpoints. HTTP credentials should use `GHOSTFRAME_PROXY_USERNAME` and `GHOSTFRAME_PROXY_PASSWORD`. `host:port:user:pass` requires `--allow-legacy-proxy-credentials`. See README "Proxy".

The full server flag surface is documented in `<cmd> --help`. The CLI subcommand exposes a filtered subset (see `src/bin/ghostframe.ts`).

## Command usage

```sh
<cmd> <tool> [arguments] [flags]
```

- Required arguments: positional.
- Optional arguments: flags (`--filePath`, `--fullPage`, etc.).

### Examples

Navigation:

```sh
gf new_page "https://example.com"
gf navigate_page "https://example.com" --type url
```

Interaction (UID from `take_snapshot`):

```sh
gf click "1_4"
gf fill "1_8" "search query"
gf type_text "hello world"
```

Detection probe:

```sh
gf new_page "https://bot.sannysoft.com"
gf take_screenshot --filePath sannysoft.png
gf take_snapshot --filePath sannysoft.txt
```

Through a proxy:

```sh
GHOSTFRAME_PROXY_USERNAME=user GHOSTFRAME_PROXY_PASSWORD=pass \
  gf start --proxy-server=203.0.113.7:8888
gf new_page "https://api.ipify.org/?format=json"
gf evaluate_script '() => document.body.innerText'
```

See the `ghostframe-detect-test` skill for the full probe workflow.

## Output format

Default: human-readable Markdown. JSON via flag:

```sh
gf list_pages --output-format=json
```

## Troubleshooting

If the CLI hangs or fails to connect:

```sh
gf stop
```

For verbose logs:

```sh
DEBUG=* gf list_pages
```

See [`troubleshooting.md`](./troubleshooting.md) for stealth-specific failures.

## CLI generation

`scripts/generate-cli.ts` generates the CLI surface from tool metadata. Some tools are excluded from generation (`wait_for`, `fill_form`). Server args that do not make sense in a CLI are filtered in `src/bin/ghostframe.ts`. Re-run `npm run cli:generate` after schema or option changes.

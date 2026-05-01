---
name: chrome-devtools-cli
description: Drives stealth-mode Chrome DevTools from the shell. Use when writing shell scripts that automate browser actions, running a quick stealth probe, or driving a one-off CDP-mediated workflow without an MCP client. Does not apply to `--slim` mode.
---

The `chrome-devtools-mcp` CLI talks to the same MCP server as an IDE client. Stealth posture, persona handling, and isolated-world routing all apply identically.

For deeper details, see:

- [`docs/cli.md`](../../docs/cli.md) — CLI flag surface and stealth-relevant flags.
- [`docs/stealth-configuration.md`](../../docs/stealth-configuration.md) — what changes vs upstream.

## Setup

If this is your first install, see [references/installation.md](references/installation.md). One-time setup; not part of the per-task workflow.

## Workflow

1. **Run a tool directly.** `chrome-devtools <tool> [args] [flags]`. The daemon and Chrome start implicitly. Do not call `start`/`status`/`stop` before each command.
2. **Snapshot.** `chrome-devtools take_snapshot` returns the accessibility tree with `uid` columns.
3. **Act.** `chrome-devtools click <uid>`, `chrome-devtools fill <uid> "<text>"`. State persists across commands.

Snapshot output shape:

```text
uid=1_0 RootWebArea "Example Domain" url="https://example.com/"
  uid=1_1 heading "Example Domain" level="1"
```

## Command shape

```sh
chrome-devtools <tool> [arguments] [flags]
```

`--help` works on every command. Output defaults to Markdown; `--output-format=json` switches to JSON.

## Input automation

```bash
chrome-devtools take_snapshot                                  # get UIDs
chrome-devtools click "1_4"
chrome-devtools click "1_4" --dblClick true --includeSnapshot true
chrome-devtools drag "1_4" "1_8"
chrome-devtools fill "1_4" "user@example.com"
chrome-devtools handle_dialog accept
chrome-devtools handle_dialog dismiss --promptText "hi"
chrome-devtools hover "1_4"
chrome-devtools press_key "Enter"
chrome-devtools press_key "Control+A" --includeSnapshot true
chrome-devtools type_text "hello"
chrome-devtools type_text "hello" --submitKey "Enter"
chrome-devtools upload_file "1_4" "file.txt"
```

All input tools run with humanized timing by default. There is no per-call override flag — see `skills/humanized-input/SKILL.md` for the global off-switch.

## Navigation

```bash
chrome-devtools list_pages
chrome-devtools new_page "https://example.com"
chrome-devtools new_page "https://example.com" --background true --timeout 5000
chrome-devtools navigate_page --url "https://example.com"
chrome-devtools navigate_page --type "reload" --ignoreCache true
chrome-devtools navigate_page --handleBeforeUnload "accept"
chrome-devtools select_page 1
chrome-devtools select_page 1 --bringToFront true
chrome-devtools close_page 1
```

## Persona / emulation

Apply once per session before any sensitive navigation. `emulate` bundles UA, UA-CH, locale, timezone, geolocation, and viewport — per-attribute mid-session changes are detectable.

```bash
chrome-devtools emulate --userAgent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ..."
chrome-devtools emulate --viewport "1920x1080" --colorScheme "dark"
chrome-devtools emulate --networkConditions "Slow 3G" --cpuThrottlingRate 4
chrome-devtools resize_page 1920 1080
```

Verify coherence after applying:

```bash
chrome-devtools evaluate_script "() => ({ ua: navigator.userAgent, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, langs: navigator.languages })"
```

## Network

```bash
chrome-devtools list_network_requests
chrome-devtools list_network_requests --pageSize 50 --pageIdx 0
chrome-devtools list_network_requests --resourceTypes Fetch
chrome-devtools get_network_request --reqid 1
chrome-devtools get_network_request --reqid 1 --requestFilePath req.md --responseFilePath res.md
```

## Debug and inspect

```bash
chrome-devtools take_screenshot
chrome-devtools take_screenshot --fullPage true --format "jpeg" --quality 80
chrome-devtools take_screenshot --uid "1_4" --filePath "el.png"
chrome-devtools take_snapshot --verbose true --filePath "snap.txt"
chrome-devtools evaluate_script "() => document.title"
chrome-devtools evaluate_script "(el) => el.innerText" --args 1_4
chrome-devtools list_console_messages
chrome-devtools list_console_messages --types error
chrome-devtools get_console_message 1
```

`evaluate_script` defaults to `world: "isolated"`. Pass `world: "main"` only when the script needs to read or write page-set globals or dispatch events the page's JS listens for. See `skills/chrome-devtools/SKILL.md` for the routing rules.

## Stealth probe (typical flow)

Manual detection check after a config change:

```bash
chrome-devtools new_page "https://bot.sannysoft.com"
chrome-devtools take_snapshot --filePath sanny.txt
chrome-devtools take_screenshot --fullPage true --filePath sanny.png

chrome-devtools new_page "https://abrahamjuliot.github.io/creepjs/"
chrome-devtools take_screenshot --fullPage true --filePath creep.png
```

Then read the snapshot and the screenshot for the failed signal categories. Full workflow in `skills/detection-testing/SKILL.md`.

## Service management

```bash
chrome-devtools start                # start the daemon
chrome-devtools start --headless     # headless launch
chrome-devtools start --userDataDir /tmp/profile  # explicit profile dir
chrome-devtools status
chrome-devtools stop
```

`start --help` shows the supported subset of server flags. Stealth-relevant flags are listed in [`docs/cli.md`](../../docs/cli.md#stealth-relevant-flags).

## What NOT to do

- Do not pipe `take_snapshot` output back into `click` arguments via shell parsing — UIDs change across snapshots. Capture the snapshot, then issue the click as a separate command using a UID you read.
- Do not script `--output-format=json | jq` parsers for tools whose JSON shape isn't documented; the shape can change.
- Do not call `evaluate_script` with `--world main` from a shell script that hasn't been reviewed for what it touches in the page's globals. Isolated is the default for a reason.

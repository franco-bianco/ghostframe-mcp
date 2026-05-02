---
name: ghostframe-cli
description: Drives stealth-mode Chrome DevTools from the shell. Use when writing shell scripts that automate browser actions, running a quick stealth probe, or driving a one-off CDP-mediated workflow without an MCP client. Does not apply to `--slim` mode.
---

# Stealth CLI

The `ghostframe` CLI talks to the same MCP server as an IDE client. Stealth posture, persona handling, and isolated-world routing all apply identically.

For deeper details, see:

- [`docs/cli.md`](../../docs/cli.md) — CLI flag surface and stealth-relevant flags.
- [`docs/stealth-configuration.md`](../../docs/stealth-configuration.md) — what changes vs upstream.

## Setup

If this is your first install, see [references/installation.md](references/installation.md). One-time setup; not part of the per-task workflow.

## Workflow

1. **Run a tool directly.** `ghostframe <tool> [args] [flags]`. The daemon and Chrome start implicitly. Do not call `start`/`status`/`stop` before each command.
2. **Snapshot.** `ghostframe take_snapshot` returns the accessibility tree with `uid` columns.
3. **Act.** `ghostframe click <uid>`, `ghostframe fill <uid> "<text>"`. State persists across commands.

Snapshot output shape:

```text
uid=1_0 RootWebArea "Example Domain" url="https://example.com/"
  uid=1_1 heading "Example Domain" level="1"
```

## Command shape

```sh
ghostframe <tool> [arguments] [flags]
```

`--help` works on every command. Output defaults to Markdown; `--output-format=json` switches to JSON.

## Input automation

```bash
ghostframe take_snapshot                                  # get UIDs
ghostframe click "1_4"
ghostframe click "1_4" --dblClick true --includeSnapshot true
ghostframe drag "1_4" "1_8"
ghostframe fill "1_4" "user@example.com"
ghostframe handle_dialog accept
ghostframe handle_dialog dismiss --promptText "hi"
ghostframe hover "1_4"
ghostframe press_key "Enter"
ghostframe press_key "Control+A" --includeSnapshot true
ghostframe type_text "hello"
ghostframe type_text "hello" --submitKey "Enter"
ghostframe upload_file "1_4" "file.txt"
```

All input tools run with humanized timing by default. There is no per-call override flag — see `skills/humanized-input/SKILL.md` for the global off-switch.

## Navigation

```bash
ghostframe list_pages
ghostframe new_page "https://example.com"
ghostframe new_page "https://example.com" --background true --timeout 5000
ghostframe navigate_page --url "https://example.com"
ghostframe navigate_page --type "reload" --ignoreCache true
ghostframe navigate_page --handleBeforeUnload "accept"
ghostframe select_page 1
ghostframe select_page 1 --bringToFront true
ghostframe close_page 1
```

## Persona / emulation

Apply once per session before any sensitive navigation. `emulate` bundles UA, UA-CH, locale, timezone, geolocation, and viewport — per-attribute mid-session changes are detectable.

```bash
ghostframe emulate --userAgent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ..."
ghostframe emulate --viewport "1920x1080" --colorScheme "dark"
ghostframe emulate --networkConditions "Slow 3G" --cpuThrottlingRate 4
ghostframe resize_page 1920 1080
```

Verify coherence after applying:

```bash
ghostframe evaluate_script "() => ({ ua: navigator.userAgent, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, langs: navigator.languages })"
```

## Network

```bash
ghostframe list_network_requests
ghostframe list_network_requests --pageSize 50 --pageIdx 0
ghostframe list_network_requests --resourceTypes Fetch
ghostframe get_network_request --reqid 1
ghostframe get_network_request --reqid 1 --requestFilePath req.md --responseFilePath res.md
```

## Debug and inspect

```bash
ghostframe take_screenshot
ghostframe take_screenshot --fullPage true --format "jpeg" --quality 80
ghostframe take_screenshot --uid "1_4" --filePath "el.png"
ghostframe take_snapshot --verbose true --filePath "snap.txt"
ghostframe evaluate_script "() => document.title"
ghostframe evaluate_script "(el) => el.innerText" --args 1_4
ghostframe list_console_messages
ghostframe list_console_messages --types error
ghostframe get_console_message 1
```

`evaluate_script` defaults to `world: "isolated"`. Pass `world: "main"` only when the script needs to read or write page-set globals or dispatch events the page's JS listens for. See `skills/ghostframe/SKILL.md` for the routing rules.

## Stealth probe (typical flow)

Manual detection check after a config change:

```bash
ghostframe new_page "https://bot.sannysoft.com"
ghostframe take_snapshot --filePath sanny.txt
ghostframe take_screenshot --fullPage true --filePath sanny.png

ghostframe new_page "https://abrahamjuliot.github.io/creepjs/"
ghostframe take_screenshot --fullPage true --filePath creep.png
```

Then read the snapshot and the screenshot for the failed signal categories. Full workflow in `skills/detection-testing/SKILL.md`.

## Service management

```bash
ghostframe start                # start the daemon
ghostframe start --headless     # headless launch
ghostframe start --userDataDir /tmp/profile  # explicit profile dir
ghostframe status
ghostframe stop
```

`start --help` shows the supported subset of server flags. Stealth-relevant flags are listed in [`docs/cli.md`](../../docs/cli.md#stealth-relevant-flags).

## What NOT to do

- Do not pipe `take_snapshot` output back into `click` arguments via shell parsing — UIDs change across snapshots. Capture the snapshot, then issue the click as a separate command using a UID you read.
- Do not script `--output-format=json | jq` parsers for tools whose JSON shape isn't documented; the shape can change.
- Do not call `evaluate_script` with `--world main` from a shell script that hasn't been reviewed for what it touches in the page's globals. Isolated is the default for a reason.

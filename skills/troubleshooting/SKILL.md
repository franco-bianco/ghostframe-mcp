---
name: troubleshooting
description: Diagnoses Chrome DevTools MCP failures in this stealth fork. Use when a tool call fails (list_pages, new_page, navigate_page), the server won't start, the target site detects the browser as a bot, or `evaluate_script` results don't match what's on the page.
---

You are diagnosing a failed call. Work the steps in order; do not skip ahead.

## Step 1: Categorize the symptom

Read the error or describe the unexpected behavior. Categorize as one of:

- **A. Server / connection failure.** MCP didn't start, `list_pages` errors immediately, `Target closed`, `ERR_MODULE_NOT_FOUND`, etc.
- **B. Target detects the browser.** Cloudflare/DataDome/Akamai/PerimeterX/Imperva/Kasada interstitial on first navigation; 403 on a previously-working URL; CAPTCHA storm.
- **C. `evaluate_script` returns the wrong thing.** Returns `undefined` for a known-present page global; returns stale values; returns isolated-world values when the page-side state is needed.
- **D. Persona disagreement.** Site detects mismatched UA / timezone / locale / proxy IP after `emulate`.
- **E. Tool not found.** Expected tool isn't available.

Each category has its own playbook below.

## Step 2A: Server / connection failure

Locate the MCP configuration first. Search the workspace for `.mcp.json`, `gemini-extension.json`, `.claude/settings.json`, `.vscode/launch.json`, `.gemini/settings.json`. Read for:

- Incorrect args or flag names (typos like `--autoBronnect`).
- `--autoConnect` in a sandboxed client.
- Missing env vars referenced in args.

If no config file is found, ask the user for theirs.

Then triage the error string:

### `Could not find DevToolsActivePort`

Specific to `--autoConnect`. The MCP cannot find the file that a running, debuggable Chrome creates. In order:

1. Confirm Chrome (right channel — Stable / Canary as the error mentions) is currently running.
2. Instruct: open `chrome://inspect/#remote-debugging` and tick "Enable remote debugging".
3. Run `list_pages`. Don't retry the original failed command yet.
4. If `list_pages` still fails, fall back to `--browserUrl http://127.0.0.1:9222` or check sandboxing.

### `Target closed`

Browser failed to launch. Close existing Chrome instances, confirm Chrome installs cleanly, retry.

### `Server starts but creates a new empty profile`

Argument typo. Check flag spelling exactly.

### `ProtocolError: Network.enable timed out` / `socket connection was closed unexpectedly`

`--autoConnect` handshake failure. Required:

1. Chrome 144+ already running.
2. Remote debugging enabled.
3. Connection prompt accepted.
4. No competing tool on the debug port.

### `ERR_MODULE_NOT_FOUND`

Wrong Node version or corrupted `npx` cache:

```sh
rm -rf ~/.npm/_npx
npm cache clean --force
```

### Sandboxing / Host validation / WSL / Windows-specific

Map to the corresponding section in [`docs/troubleshooting.md`](../../docs/troubleshooting.md).

## Step 2B: Target detects the browser

Probable cause is launch posture, persona, or behavioral. Walk these in order:

1. **Check `navigator.webdriver`.**
   ```bash
   chrome-devtools evaluate_script "() => navigator.webdriver"
   ```
   If `true`: launch flags are leaking. `--enable-automation` not stripped, or `--disable-blink-features=AutomationControlled` missing. See [`docs/stealth-configuration.md#default-flag-posture`](../../docs/stealth-configuration.md#default-flag-posture).

2. **Check the UA for `HeadlessChrome`.**
   ```bash
   chrome-devtools evaluate_script "() => navigator.userAgent"
   ```
   If present: running headless without a persona override. Apply `emulate` with a stealth persona, or run headed.

3. **Check the WebGL renderer.**
   ```bash
   chrome-devtools evaluate_script "() => { const c=document.createElement('canvas').getContext('webgl'); const e=c.getExtension('WEBGL_debug_renderer_info'); return c.getParameter(e.UNMASKED_RENDERER_WEBGL); }"
   ```
   `SwiftShader` or `Google Inc. (Google)` indicates software rendering — a bot tell. Run on a host with GPU access or apply WebGL polyfills.

4. **Run `bot.sannysoft.com`.** The matrix tells you which signal class flipped you. Hand off to `skills/detection-testing/` for the full sweep.

5. **If all four detectors pass and the target still blocks**, hand off to `skills/diagnose-bot-block/`.

## Step 2C: `evaluate_script` returns the wrong thing

Most common cause: world mismatch.

| Symptom | Likely cause | Fix |
|---|---|---|
| Script returns `undefined` for a `window.foo` set by the page | Ran in isolated world | Pass `world: "main"` |
| Script reads stale DOM after a click | Page-side handler hasn't run yet | Add `wait_for` between click and eval |
| Script throws `Cannot read property 'X' of undefined` for a page-defined global | Isolated world cannot see page globals | Pass `world: "main"` |
| Script in main world is rejected | Stealth mode gates main-world for agent-injected scripts | Re-route through user-supplied call, or rewrite to be isolated-world-safe |

See [`skills/chrome-devtools/SKILL.md`](../chrome-devtools/SKILL.md) for the routing rules.

## Step 2D: Persona disagreement

Run the coherence probe:

```bash
chrome-devtools evaluate_script "() => ({
  ua: navigator.userAgent,
  uaCH: navigator.userAgentData?.toJSON(),
  langs: navigator.languages,
  platform: navigator.platform,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  locale: Intl.DateTimeFormat().resolvedOptions().locale
})"
```

Then compare against:

- The persona you passed to `emulate`. Any disagreement means `emulate` did not bundle the attribute.
- The proxy egress IP geo. Verify externally — `https://ipinfo.io/json` — and confirm the IP's geo aligns with the timezone and locale.

A US-Pacific timezone behind a Frankfurt egress IP is a stronger detection signal than any single mismatched value.

## Step 2E: Tool not found

- The fork strips `lighthouse_audit`, `take_memory_snapshot`, `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`. They are intentionally absent. Do not request them.
- `--slim` mode exposes only navigation and screenshot tools. Confirm the client isn't running slim.
- If the tool is `install_extension` or other extension tooling, the server needs `--categoryExtensions` and (for Chrome <149) must launch Chrome itself rather than connect.
- Some MCP clients enforce read-only mode and hide tools annotated `readOnlyHint: false`. The full set requires turning off the client's read-only / plan-mode setting.

## Step 3: Read upstream known issues

Map remaining symptoms to [`docs/troubleshooting.md`](../../docs/troubleshooting.md). It has the inherited environment cases (sandboxing, WSL, Windows shell wrapping, Web Bluetooth on macOS).

## Step 4: Capture verbose logs

If the issue is still unclear:

```sh
DEBUG=* npx chrome-devtools-mcp@latest --logFile=/tmp/cdm.log
```

Read the log for:

- Launch flags actually applied (compare against expected stealth posture).
- CDP domains enabled at startup (Universe gate verification).
- Persona application (one `emulate` call should produce multiple CDP calls; confirm all of them happened).

## Step 5: Confirm with diagnostics

If the user is still stuck:

```sh
npx chrome-devtools-mcp@latest --help
```

Confirms install, Node version, basic startup. If this fails, the rest is moot — fix the install.

## Step 6: Search known issues

Check the upstream repo for similar symptoms before declaring novel:

```sh
gh issue list --repo ChromeDevTools/chrome-devtools-mcp --search "<error snippet>" --state all
```

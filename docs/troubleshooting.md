# Troubleshooting

Stealth-specific symptoms first, then inherited connection/environment issues.

## General tips

- Run `npx chrome-devtools-mcp@latest --help` to confirm the server starts.
- Match the npm and node version between your MCP client and your terminal.
- Use `--yes` on `npx` to auto-accept install prompts in clients that don't surface them.
- Server stderr is in the client's Output pane (most IDE clients).
- Search the upstream repo for matches before opening an issue.

## Debugging

Verbose logs to a file:

```sh
DEBUG=* npx chrome-devtools-mcp@latest --log-file=/tmp/cdm.log
```

Through `.mcp.json`:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "chrome-devtools-mcp@latest",
        "--log-file",
        "/tmp/cdm.log"
      ],
      "env": { "DEBUG": "*" }
    }
  }
}
```

## Stealth-specific symptoms

### Detected on first navigation by Cloudflare / DataDome / Akamai / PerimeterX / Imperva / Kasada

You navigate to a target site and immediately get an interstitial, a 403, or a JS challenge.

Triage in this order:

1. **Confirm `navigator.webdriver`**. Run `evaluate_script` against the target page (or a neutral one) with the script `() => navigator.webdriver`. If `true`, the launch posture is leaking. See [`docs/stealth-configuration.md#default-flag-posture`](./stealth-configuration.md#default-flag-posture). Likely cause: `--enable-automation` is still in the default args (`src/browser.ts:197-198`) or `--disable-blink-features=AutomationControlled` is missing (`src/browser.ts:193-196`).
2. **Confirm UA does not contain `HeadlessChrome`**. Run `() => navigator.userAgent`. If present, you are running headless without a persona override. Apply `emulate` with a stealth persona, or run headed.
3. **Run a detector page**. Open `bot.sannysoft.com` in the same session. The test matrix tells you which signal class flipped you. See [`skills/detection-testing/SKILL.md`](../skills/detection-testing/SKILL.md).
4. **Diff CDP enables**. The Universe gate (`src/DevtoolsUtils.ts:142-156`) leaves `Runtime.enable` and `Debugger.enable` open by default. In stealth mode this is gated; verify the gate is active for your config.

If the target also passes the four detectors, follow [`skills/diagnose-bot-block/SKILL.md`](../skills/diagnose-bot-block/SKILL.md).

### `evaluate_script` does not see DOM changes the page just made

Most likely: the script ran in an isolated world while the change is main-world state.

Decision: if the script needs to read `window.foo` set by the page, pass `world: "main"`. If it only needs to read DOM, leave it isolated.

See [`docs/stealth-configuration.md#evaluate_script-and-isolated-worlds`](./stealth-configuration.md#evaluate_script-and-isolated-worlds) for the full routing table.

### `evaluate_script` fails with "main world is gated"

You requested `world: "main"` from an agent-side script in stealth mode. Stealth mode allows main-world for user-supplied scripts; agent-injected helpers stay isolated. Either route through a user-call, or rewrite the script to be isolated-world-safe.

### Persona looks right but the site still flags us

Coherence check. After `emulate`, evaluate each of the following and confirm they all match the same persona:

```javascript
() => ({
  ua: navigator.userAgent,
  uaCH: navigator.userAgentData?.toJSON(),
  langs: navigator.languages,
  platform: navigator.platform,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  locale: Intl.DateTimeFormat().resolvedOptions().locale
})
```

Also verify the proxy egress IP geo agrees with the timezone. A US/Pacific timezone behind a Frankfurt egress IP is a stronger signal than any single value.

### Humanized input feels too slow

Default-on humanization adds 80–600 ms per interaction. For test suites that don't need stealth, the global off-switch exists. Do not add per-call timing overrides — they fragment the persona. See [`skills/humanized-input/SKILL.md`](../skills/humanized-input/SKILL.md).

### `chrome.runtime` polyfill is detected

Polyfills are detected by their *shape*. The fix is rarely to add a flag; it is to update the polyfill to track the upstream reference (Patchright). Read [`docs/detection-signals.md#dom-layer`](./detection-signals.md#dom-layer) before patching.

### `navigator.webdriver` is `false` but `Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver')` reveals an override

The override itself is the signal. The fix is to delete the property descriptor at `addScriptToEvaluateOnNewDocument` time, not to set the value. See the borrow-target list in [`skills/borrow-stealth-feature/SKILL.md`](../skills/borrow-stealth-feature/SKILL.md).

## Inherited environment issues

### `Error [ERR_MODULE_NOT_FOUND]: Cannot find module ...`

Wrong Node version or corrupted npx cache:

```sh
rm -rf ~/.npm/_npx
npm cache clean --force
```

### `Target closed`

Browser failed to start. Close any running Chrome instances. Confirm Chrome is installed and the system can run it.

### Chrome crashes on macOS with Web Bluetooth

macOS TCC permission issue. Grant Bluetooth to the MCP client app in System Settings > Privacy & Security > Bluetooth, then restart the client.

### Remote debugging from VM to host fails

Chrome rejects the connection on `Host` header validation. Tunnel:

```sh
ssh -N -L 127.0.0.1:9222:127.0.0.1:9222 <user>@<host-ip>
```

Then point the MCP at `http://127.0.0.1:9222`.

### OS sandboxes (macOS Seatbelt, Linux containers)

If the client sandboxes the MCP server, `chrome-devtools-mcp` cannot launch a sandboxed Chrome. Either disable client-side sandboxing for the MCP, or run Chrome manually outside the sandbox and connect with `--browser-url`.

### WSL

Chrome must be installed inside the Linux environment by default. Two paths:

- **Install Chrome in WSL**:
  ```sh
  wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  sudo dpkg -i google-chrome-stable_current_amd64.deb
  ```
- **Mirrored networking + Chrome on Windows**:
  1. Configure mirrored networking for WSL.
  2. Start Chrome: `chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\path\to\dir`.
  3. `npx chrome-devtools-mcp --browser-url http://127.0.0.1:9222`

### Windows 10: `MCP error -32000: Connection closed`

Wrap `npx` in `cmd /c`:

```json
"chrome-devtools": {
  "command": "cmd",
  "args": ["/c", "npx", "-y", "chrome-devtools-mcp@latest"]
}
```

Or use the absolute path to `npx` (with double backslashes in JSON).

### `--autoConnect` connection timeouts

Symptoms: `ProtocolError: Network.enable timed out`, `socket connection was closed unexpectedly`. Required state:

1. Chrome 144+ already running.
2. Remote debugging enabled at `chrome://inspect/#remote-debugging`.
3. Connection prompt accepted.
4. No other tool holding the debugging port.

In Chrome 144–149, frozen or unloaded tabs can also block the handshake. The fork forces tabs to load; ensure the host has memory headroom. Avoid `--autoConnect` on browsers with hundreds of tabs.

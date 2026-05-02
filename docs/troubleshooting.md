# Troubleshooting

Stealth-specific symptoms first, then inherited connection/environment issues.

In examples below, `BIN` is the fork's MCP entrypoint:

```sh
BIN=/absolute/path/to/chromedevtools-mcp-stealth/build/src/bin/chrome-devtools-mcp.js
```

## General tips

- Run `node $BIN --help` to confirm the server starts.
- Match the Node version between your MCP client and your shell.
- Server stderr is in the client's Output / Logs pane (most IDE clients).
- `--no-stealth` is the diagnostic: if a problem disappears with stealth off, it is in our stealth path; if it persists, it is in the inherited path or the target site.

## Debugging

Verbose logs to a file:

```sh
DEBUG=* node $BIN --log-file=/tmp/cdm.log
```

Through `.mcp.json`:

```json
{
  "mcpServers": {
    "chrome-devtools-stealth": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/build/src/bin/chrome-devtools-mcp.js",
        "--log-file",
        "/tmp/cdm.log"
      ],
      "env": {"DEBUG": "*"}
    }
  }
}
```

## Stealth-specific symptoms

### Detected on first navigation by Cloudflare / DataDome / Akamai / PerimeterX / Imperva / Kasada

You navigate to a target site and immediately get an interstitial, a 403, or a JS challenge.

Triage in this order:

1. **Confirm `navigator.webdriver`**. Run `evaluate_script` against the target page (or a neutral one) with `() => navigator.webdriver`. If `true`, the launch posture is leaking. See [`stealth-configuration.md#default-flag-posture`](./stealth-configuration.md#default-flag-posture). Likely cause: launch happened with `--no-stealth`, or you are connected to a running Chrome that was started without the launch-time strip.
2. **Confirm UA does not contain `HeadlessChrome`**. Run `() => navigator.userAgent`. If present, you are running headless without a persona override. Apply `emulate` with a stealth persona, or run headed.
3. **Run a detector page**. Open `bot.sannysoft.com` in the same session. The test matrix tells you which signal class flipped you. See [`skills/detection-testing/SKILL.md`](../skills/detection-testing/SKILL.md).
4. **Diff CDP enables**. The Universe gate (`src/DevtoolsUtils.ts:55-127`, gated in `src/McpContext.ts`) is the largest CDP-detectable leak. Confirm you are on `--stealth` (default).
5. **Check the IP reputation**. Datacenter IPs may get a stricter Cloudflare policy regardless of stealth. Try a residential proxy.

If the target also passes the four detectors, follow [`skills/diagnose-bot-block/SKILL.md`](../skills/diagnose-bot-block/SKILL.md).

### `evaluate_script` does not see DOM changes the page just made

Most likely: the script ran in an isolated world while the change is main-world state.

`evaluate_script` defaults to `world: 'isolated'`. To read `window.foo` set by the page, pass `world: 'main'`. To read DOM only, leave it isolated.

When `args` (element UIDs) are passed, the default falls back to `'main'` automatically — element handles can only be evaluated in the realm that created them.

See [`stealth-configuration.md#evaluate_script-and-isolated-worlds`](./stealth-configuration.md#evaluate_script-and-isolated-worlds) for the full routing table.

### `list_console_messages` returns nothing

Expected behaviour under `--stealth`. The Universe gate also disables the console / pageerror / `Runtime.exceptionThrown` listeners that implicitly enable `Runtime`. Console data is not collected.

If you need console messages, run with `--no-stealth`. You forfeit the Universe gate's stealth benefit.

### Persona looks right but the site still flags us

Coherence check. After `emulate`, evaluate each of the following and confirm they match the same persona:

```javascript
() => ({
  ua: navigator.userAgent,
  uaCH: navigator.userAgentData?.toJSON(),
  langs: navigator.languages,
  platform: navigator.platform,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  locale: Intl.DateTimeFormat().resolvedOptions().locale,
})
```

Also verify the proxy egress IP geo agrees with the timezone. A US/Pacific timezone behind a Frankfurt egress IP is a stronger signal than any single value.

### Humanized input feels too slow

Default-on humanization adds 80–600 ms per interaction. For test suites that don't need stealth, run with `--no-stealth`. Do not add per-call timing overrides — they fragment the persona. See [`skills/humanized-input/SKILL.md`](../skills/humanized-input/SKILL.md).

### `chrome.runtime` polyfill is detected

Polyfills are detected by their *shape*. The fix is rarely to add a flag; it is to update the polyfill to track the upstream reference (Patchright). Read [`detection-signals.md#dom-layer`](./detection-signals.md#dom-layer) before patching.

### `navigator.webdriver` is `false` but `Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver')` reveals an override

The override itself is the signal. The fix is to delete the property descriptor at `addScriptToEvaluateOnNewDocument` time, not to set the value. See the borrow-target list in [`skills/borrow-stealth-feature/SKILL.md`](../skills/borrow-stealth-feature/SKILL.md).

### Cloudflare Turnstile / hCaptcha / reCAPTCHA Enterprise blocks the page

Out of scope for the fork. These are interactive challenges that require a real user click on the widget or TLS-level fingerprint fidelity beyond what JS-side stealth can spoof. Pair the fork with a CAPTCHA solver service, or do the click yourself in headed mode.

The fork passes standard Cloudflare Bot Management. Sites that layer Turnstile at the actual transaction surface (e.g. AXS at `tix.axs.com`, Ticketmaster seat pickers) have a second gate that the fork alone cannot clear.

## Inherited environment issues

### `Error [ERR_MODULE_NOT_FOUND]: Cannot find module ...`

Wrong Node version or missing `node_modules`:

```sh
cd /absolute/path/to/chromedevtools-mcp-stealth
npm install
npm run build
```

### `Target closed` on launch

Browser failed to start. Close any running Chrome instances on the same `--user-data-dir`. Confirm Chrome is installed and the system can run it.

### Chrome crashes on macOS with Web Bluetooth

macOS TCC permission issue. Grant Bluetooth to the MCP client app in System Settings → Privacy & Security → Bluetooth, then restart the client.

### Remote debugging from VM to host fails

Chrome rejects the connection on `Host` header validation. Tunnel:

```sh
ssh -N -L 127.0.0.1:9222:127.0.0.1:9222 <user>@<host-ip>
```

Then point the MCP at `http://127.0.0.1:9222` via `--browser-url`.

### OS sandboxes (macOS Seatbelt, Linux containers)

If the client sandboxes the MCP server, the fork cannot launch a sandboxed Chrome. Either disable client-side sandboxing for the MCP, or run Chrome manually outside the sandbox and connect with `--browser-url`.

### WSL

Chrome must be installed inside the Linux environment by default. Two paths:

1. **Install Chrome in WSL:**

   ```sh
   wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
   sudo dpkg -i google-chrome-stable_current_amd64.deb
   ```

2. **Mirrored networking + Chrome on Windows:**
   1. Configure mirrored networking for WSL.
   2. Start Chrome: `chrome.exe --remote-debugging-port=9222 --user-data-dir=C:\path\to\dir`.
   3. `node $BIN --browser-url http://127.0.0.1:9222`.

### Windows 10: `MCP error -32000: Connection closed`

Wrap the launch in `cmd /c`:

```json
"chrome-devtools-stealth": {
  "command": "cmd",
  "args": [
    "/c",
    "node",
    "C:\\absolute\\path\\to\\build\\src\\bin\\chrome-devtools-mcp.js"
  ]
}
```

Use double backslashes in JSON strings on Windows.

### `--auto-connect` connection timeouts

Symptoms: `ProtocolError: Network.enable timed out`, `socket connection was closed unexpectedly`. Required state:

1. Chrome 144+ already running.
2. Remote debugging enabled at `chrome://inspect/#remote-debugging`.
3. Connection prompt accepted.
4. No other tool holding the debugging port.

In Chrome 144–149, frozen or unloaded tabs can also block the handshake. Avoid `--auto-connect` on browsers with hundreds of tabs.

### Profile lock collision with the upstream MCP

Symptom: `The browser is already running for /Users/.../.cache/chrome-devtools-mcp/chrome-profile`.

This fork uses `~/.cache/chrome-devtools-mcp-stealth/...` to coexist with upstream, so the lock collision should not happen with both running. If you see it on this fork's path, another `chrome-devtools-mcp-stealth` instance is running — stop it (`<cmd> stop`) or use `--isolated` for ephemeral profiles.

# Troubleshooting

Stealth-specific symptoms first, then inherited connection/environment issues.

In examples below, `BIN` is the fork's MCP entrypoint:

```sh
BIN=/absolute/path/to/ghostframe-mcp/build/src/bin/ghostframe-mcp.js
```

## General tips

- Run `node $BIN --help` to confirm the server starts.
- Match the Node version between your MCP client and your shell.
- Server stderr is in the client's Output / Logs pane (most IDE clients).

## Debugging

Verbose logs to a file:

```sh
DEBUG=* node $BIN --log-file=/tmp/cdm.log
```

Through `.mcp.json`:

```json
{
  "mcpServers": {
    "ghostframe": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/ghostframe-mcp/build/src/bin/ghostframe-mcp.js",
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

1. **Confirm UA does not contain `HeadlessChrome`**. Run `() => navigator.userAgent`. The launcher rewrites it automatically on headless launches, so a `Headless` string here means the init script did not run.
2. **Run a detector page**. Open `bot.sannysoft.com` in the same session. The test matrix tells you which signal class flipped you. See the `ghostframe-detect-test` skill.
3. **Confirm the persona reaches every tab**. Personas propagate to new pages automatically; run `() => navigator.userAgent` on the tab that failed, not just the first one.
4. **Check the IP reputation**. Datacenter IPs may get a stricter Cloudflare policy regardless of stealth. Try a residential proxy.

If the target also passes the four detectors, follow the `ghostframe-diagnose-block` skill.

### `evaluate_script` does not see DOM changes the page just made

Most likely: the script ran in an isolated world while the change is main-world state.

`evaluate_script` defaults to `world: 'isolated'`. To read `window.foo` set by the page, pass `world: 'main'`. To read DOM only, leave it isolated.

When `args` (element UIDs) are passed, the default falls back to `'main'` automatically — element handles can only be evaluated in the realm that created them.

See [`stealth-configuration.md#evaluate_script-and-isolated-worlds`](./stealth-configuration.md#evaluate_script-and-isolated-worlds) for the full routing table.

### `list_console_messages` returns nothing

Console capture uses the page's existing primary CDP session.
It remains active during ordinary stealth use.
The separate DevTools Universe stays disabled.

Check the selected page and the message type filter.
Messages from before collection started can be absent.
Worker-only messages may not appear in the page's console list.
If JavaScript is paused, resume it before a foreground console inspection.
See [the investigation guide](investigation.md) for pause controls.

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
});
```

Also verify the proxy egress IP geo agrees with the timezone. A US/Pacific timezone behind a Frankfurt egress IP is a stronger signal than any single value.

### Humanized input feels too slow

### `chrome.runtime` polyfill is detected

Polyfills are detected by their _shape_. The fix is rarely to add a flag; it is to update the polyfill to track the upstream reference (Patchright). Read [`detection-signals.md#dom-layer`](./detection-signals.md#dom-layer) before patching.

### `navigator.webdriver` is `false` but `Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver')` reveals an override

The override itself is the signal. The fix is to delete the property descriptor at `addScriptToEvaluateOnNewDocument` time, not to set the value. See the `ghostframe-borrow-feature` skill.

### Cloudflare Turnstile / hCaptcha / reCAPTCHA Enterprise blocks the page

Out of scope for the fork. These are interactive challenges that require a real user click on the widget or TLS-level fingerprint fidelity beyond what JS-side stealth can spoof. Pair the fork with a CAPTCHA solver service, or do the click yourself in headed mode.

The fork passes standard Cloudflare Bot Management. Sites that layer Turnstile at the actual transaction surface (e.g. AXS at `tix.axs.com`, Ticketmaster seat pickers) have a second gate that the fork alone cannot clear.

## Inherited environment issues

### `Error [ERR_MODULE_NOT_FOUND]: Cannot find module ...`

Wrong Node version or missing `node_modules`:

```sh
cd /absolute/path/to/ghostframe-mcp
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

### OS sandboxes (macOS Seatbelt, Linux containers)

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

### Windows 10: `MCP error -32000: Connection closed`

Wrap the launch in `cmd /c`:

```json
"ghostframe": {
  "command": "cmd",
  "args": [
    "/c",
    "node",
    "C:\\absolute\\path\\to\\ghostframe-mcp\\build\\src\\bin\\ghostframe-mcp.js"
  ]
}
```

Use double backslashes in JSON strings on Windows.

Symptoms: `ProtocolError: Network.enable timed out`, `socket connection was closed unexpectedly`. Required state:

1. Chrome 144+ already running.
2. Remote debugging enabled at `chrome://inspect/#remote-debugging`.
3. Connection prompt accepted.
4. No other tool holding the debugging port.

### Profile lock collision with the upstream MCP

Symptom: `The browser is already running for /Users/.../.cache/chrome-devtools-mcp/chrome-profile`.

This fork uses `~/.cache/ghostframe-mcp/...` (and `~/.cache/ghostframe-cli/...` for the CLI path) to coexist with upstream, so the lock collision should not happen with both running. If you see it on the fork's path, another `ghostframe-mcp` instance is running — stop it (`ghostframe stop`) or use `--isolated` for ephemeral profiles.

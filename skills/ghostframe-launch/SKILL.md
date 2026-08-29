---
name: ghostframe-launch
description: Launch the stealth browser and verify it is safe to drive a bot-managed site. Use before navigating to a target behind Cloudflare, DataDome, Akamai, PerimeterX, Imperva or Kasada, after changing launch flags or Chrome channel, or after applying a persona. Runs automatically and reports one verdict.
---

# Launch and verify

Run this end to end without pausing. Two tool calls, then one verdict. Do not narrate
between calls, do not read docs mid-run, and do not ask the user anything unless the
verdict is FAIL.

Use the `mcp__ghostframe__*` tools. Never shell out — the `ghostframe` CLI is only on
PATH if someone ran `npm link`, and nothing here needs a shell.

## Run

**1.** `navigate_page` to `https://ipinfo.io/json`.

One HTTPS page satisfies everything at once. `navigator.userAgentData` is gated to
secure contexts, so on `about:blank` it reads back empty and looks like a persona
failure when it is not. This page also returns the egress geo.

**2.** One `evaluate_script`:

```javascript
() => {
  const gl = document.createElement('canvas').getContext('webgl');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return {
    ua: navigator.userAgent,
    uaCH: navigator.userAgentData?.toJSON() ?? null,
    langs: navigator.languages,
    platform: navigator.platform,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    webdriver: navigator.webdriver,
    egress: JSON.parse(document.body.innerText),
    webgl: dbg
      ? {
          vendor: gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL),
          renderer: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL),
        }
      : 'no-webgl',
  };
};
```

## Verdict

Report PASS or FAIL in three lines or fewer. FAIL on any of:

- **Split identity.** `ua`, `uaCH.platform`, `platform`, `langs`, `tz` and `locale` do
  not describe one machine.
- **Timezone against egress.** `tz` does not match the country in `egress`. This is the
  heaviest signal here and the only one a persona cannot fix alone — it needs the right
  proxy.
- **Software rendering.** `webgl.renderer` contains `SwiftShader`, or vendor and
  renderer are empty. Real hardware reads like
  `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max)`.
- **`webdriver` is anything but `false`.**

On PASS, say so and stop. The caller can navigate to the target.

On FAIL, name the field and the fix, then stop. Do not attempt repairs on your own —
a persona change mid-session is itself a signal.

If no persona has been applied, the values are the host machine's. Say so in the
verdict rather than treating it as a failure; it is fine for a throwaway session and
wrong for a target that profiles you.

## What this does not check, and why

Fixed by the launch, so not worth a round trip:

- `Navigator.prototype.webdriver` keeps its native getter. Do not "fix" a present
  descriptor — the native accessor is correct, and replacing it is the leak.
- The user agent does not say `HeadlessChrome`; the launcher rewrites it.
- `navigator.plugins` is non-empty. Headless reports the same five entries as headed.
- Nothing holds a second CDP session or `Debugger.enable` open. The DevTools Universe
  was removed.
- There is one launch path. Connect mode is gone.

## After a PASS

Hand off to `ghostframe-detect-test` before the first sensitive navigation if the
target is high-value. Do not inline a detector page here; that skill reads the full
matrix across four detectors.

---
name: ghostframe
description: Drives a stealth-mode Chrome via MCP. Use when automating browser interactions on sites that watch for bots (Cloudflare, DataDome, Akamai, PerimeterX, Imperva, Kasada), inspecting network traffic on those sites, or driving CDP scripts through isolated worlds. Does not apply to `--slim` mode.
---

# Stealth Chrome DevTools MCP

This skill orients you to Chrome DevTools MCP in this stealth fork. It is not the general-purpose browser MCP. Routing decisions, world selection, and persona handling differ.

For deeper details, see:

- [`docs/stealth-configuration.md`](../../docs/stealth-configuration.md) — flag set, profile, persona, polyfills.
- [`docs/detection-signals.md`](../../docs/detection-signals.md) — what bots watch for and why we configure the way we do.
- [`docs/troubleshooting.md`](../../docs/troubleshooting.md) — symptom-to-fix mapping.

## What changes vs upstream

- **Stealth posture is on by default.** Launch flags strip `--enable-automation`, add `--disable-blink-features=AutomationControlled`, gate the Universe (no held-open `Runtime.enable`/`Debugger.enable`).
- **Isolated worlds for agent eval.** `evaluate_script` defaults to `world: "isolated"`. Read the routing rules below before passing `world: "main"`.
- **Humanized input by default.** `click`, `hover`, `type_text`, `drag` use plausible timing distributions. One global off-switch exists for tests; no per-call overrides.
- **Persona-coherent emulation.** `emulate` accepts a bundled persona (UA, UA-CH, locale, timezone, geolocation, viewport). One change touches all attributes.
- **Stripped tools.** `lighthouse_audit`, `take_memory_snapshot`, `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight` are not available. They require CDP domains that leak.

## Core workflow

### Before any interaction

1. **Confirm browser state.** `list_pages` and pick a page or `new_page` to a starting URL.
2. **Wait.** `wait_for` against a known content marker if the page loads asynchronously.
3. **Snapshot.** `take_snapshot` returns the accessibility tree with element `uid`s. Each `uid` is interaction-stable for that snapshot.
4. **Interact.** `click`, `fill`, `hover`, `type_text`, `drag`, `press_key`, `upload_file`, `handle_dialog` — all take a `uid`.
5. **Re-snapshot when state changed.** Set `includeSnapshot: true` on the interaction or call `take_snapshot` again. UIDs from a stale snapshot will fail.

### Picking the right world for `evaluate_script`

Default is `isolated`. Pass `world: "main"` only when one of the rules below applies.

1. **Read-only DOM access from agent-side code?** → isolated. (Querying `document.querySelector(...)`, walking elements, returning text.)
2. **Need `window.foo` set by the page?** → main. Isolated worlds do not see page-set globals.
3. **Sets state visible to the page?** → main. (Dispatching events the page listens for, modifying `localStorage` the page reads, calling page-defined functions.)
4. **Injected by the agent rather than the user?** → isolated. The user's explicit `evaluate_script` may opt into main; agent helpers stay isolated.

A worked example. Reading the page's title:

```javascript
// isolated is fine — DOM read
() => document.title;
```

Reading a SPA's router state that the framework parks on `window.__APP__`:

```javascript
// must be main — page-set global
() => window.__APP__?.router.currentRoute;
```

Triggering a click that the page's framework expects to receive a synthetic event:

```javascript
// must be main — page-side handler reads details
uid => {
  uid.dispatchEvent(new MouseEvent('click', {bubbles: true}));
};
```

The fork uses `Symbol.for('dtmcp')` rather than a global `__dtmcp` so the page's enumerable global surface is unchanged. Do not write to `window.__dtmcp`.

### Picking between snapshot and screenshot

- `take_snapshot` — text, fast, the right tool for most automation.
- `take_screenshot` — visual. Use when the user needs to see state, or when `take_snapshot` returns nothing useful (canvas-rendered apps).
- `evaluate_script` — escape hatch for state not in the accessibility tree.

### Parallel calls

Independent calls in a single message are fine. Order is enforced when calls have dependencies: `navigate_page` → `wait_for` → `take_snapshot` → `click`.

## Persona and emulation

Run `emulate` once per session with a coherent persona. The persona bundles UA + UA-CH + `Accept-Language` + locale + timezone + geolocation + viewport. Per-attribute changes mid-session are detectable and should be avoided.

After `emulate`, verify coherence with one `evaluate_script` call:

```javascript
() => ({
  ua: navigator.userAgent,
  uaCH: navigator.userAgentData?.toJSON(),
  langs: navigator.languages,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  locale: Intl.DateTimeFormat().resolvedOptions().locale,
});
```

If any one disagrees with the persona you set, see [`docs/troubleshooting.md`](../../docs/troubleshooting.md) → "Persona looks right but the site still flags us".

## When `ghostframe-mcp` is insufficient

For interactive debugging that the MCP cannot reach, fall back to Chrome DevTools UI:

- <https://developer.chrome.com/docs/devtools>

For launch failures, see [`docs/troubleshooting.md`](../../docs/troubleshooting.md).

For stealth-specific failures (detected by the target, persona incoherence, isolated-world routing confusion), see the dedicated skills:

- `skills/stealth-launch/` — pre-flight verification.
- `skills/detection-testing/` — verify against public detectors.
- `skills/diagnose-bot-block/` — investigate why a specific site blocks.
- `skills/humanized-input/` — input timing and the global off-switch.
- `skills/borrow-stealth-feature/` — porting a feature from a reference stealth project.

## What NOT to do

- Do not call `evaluate_script` with `world: "main"` for read-only DOM queries. Isolated is enough and reduces the main-world surface a detector probes.
- Do not mix two personas in one session. Pick one and hold it.
- Do not paper over a `navigator.webdriver === true` finding by setting the property in JS — set the launch flag and remove the property descriptor.
- Do not add per-call humanization overrides. The single global off-switch is the contract.
- Do not request the stripped tools (`lighthouse_audit`, `take_memory_snapshot`, `performance_*`). They are gone for a reason.

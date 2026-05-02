---
name: humanized-input
description: Operate the humanized-input subsystem. Use when authoring stealth interaction scripts, when input timing is suspected as the failing layer in `diagnose-bot-block`, or when running deterministic tests that need timings off. Defaults are on; one global off-switch exists; per-call overrides do not exist.
---

# Humanized input

`click`, `hover`, `type_text`, `drag` produce input events with humanized timing by default. The intent is to make input look like a person used it, not a script.

For the underlying signal model and the empirical distribution citations, see [`docs/detection-signals.md#behavioral-layer`](../../docs/detection-signals.md#behavioral-layer).

## Default scope

Operates session-wide. The off-switch is global, not per-tool or per-call. If you need deterministic timing for a single test, flip the switch off, run the test, and flip it back on. The model should not insert per-call timing parameters.

## What the defaults do

- **Mouse**. Cubic-bezier path from origin to target with 1–3 control-point jitters. 8–24 `mouseMoved` events along the path. 8–30 ms non-uniform inter-event gap. Optional 80–250 ms pre-press dwell. 40–180 ms down-to-up dwell.
- **Typing**. Lognormal flight (gap between keypresses) 80–250 ms with mean ~110 ms. Dwell (key-down to key-up) 50–150 ms. Thinking pause 350–600 ms every 8–25 characters.
- **Drag**. 80–280 ms randomized inter-step. Replaces the inherited 50 ms uniform gap.

These distributions are seeded from human-typing studies cited in [`docs/detection-signals.md`](../../docs/detection-signals.md). Do not adjust them by gut feel.

## Workflow

### 1. Confirm humanization is on

Stealth runs require it on. The fork has not yet completed humanization migration on every tool — current inherited code paths have zero humanization at `src/tools/input.ts:67-69,105,141,214,272,344,434-438`. Treat the global flag as default-off and verify per tool until the migration lands.

```bash
ghostframe status
```

The status output names the active config. If you cannot tell from `status`, run a probe: type 50 characters into a focused input and time the call. Sub-second indicates humanization is off.

### 2. For stealth runs, leave it on

Do not pass per-call timing flags. They do not exist. If you find one, file a bug — it should not be there.

### 3. For deterministic tests, flip the switch off

The off-switch exists for tests that must not have non-determinism. Pre-test:

```bash
# off-switch flag name TBD; current planned posture is a single global config
ghostframe start --no-humanize
```

Post-test, restart with humanization on:

```bash
ghostframe stop
ghostframe start
```

Do not run stealth-sensitive flows with `--no-humanize` enabled.

### 4. After changing humanization, re-verify behavioral layer

If you have edited the distributions or the off-switch, re-run the detector sweep. CreepJS does some behavioral sampling; the matrix tests at sannysoft / vastel test less of it. Targets that block behaviorally usually do so silently — run `skills/detection-testing/` and then probe a low-stakes target that you know enforces.

## Coherence with persona

Humanization timings should sit inside the persona's plausibility envelope. The relevant coherence checks:

- **Locale and typing**. A persona with `locale: ja-JP` typing English at 120ms cadence is coherent (`ja-JP` users routinely type Latin-alphabet text). A persona typing logographic-rate cadence in English is not.
- **Platform and pointer**. A persona claiming `navigator.platform === 'Linux x86_64'` running pointer events shaped like trackpad scrolling on macOS is incoherent.
- **Viewport and reach**. Click coordinates that cluster in the same region across a session look human. Click coordinates that distribute uniformly across the viewport look like a script.

These are not currently enforced in code; they are operator concerns. Hold to them when authoring scripts.

## Six danger signs

Reproduced from `skills/diagnose-bot-block/`. Behavioral tells:

1. Cursor reaches target in one frame (humanization off, or `click_at` used directly).
2. All inter-key intervals are 0 ms (typing without humanization).
3. Scroll deltas are uniform.
4. No `focus`/`blur` events between form fields.
5. No `selectionchange` while typing.
6. Identical session-to-session input timings.

If you see any of these in a captured network trace or telemetry, humanization was off or stripped at a higher layer.

## Tips

- Run a typing probe once after launch. 50 characters into a focused input; expect 5–8 seconds with humanization on. Sub-second means humanization is not active.
- Do not "tune" the distributions to match a specific person's typing style. The defaults track empirical data; a tuned-by-feel distribution drifts from the population.
- When stealth-launching a session, the off-switch should be off (i.e. humanization on). Verify in `status` output.

## What NOT to do

- Do not introduce per-call timing parameters. The global off-switch is the contract.
- Do not run a stealth-sensitive workflow with the off-switch enabled. The fork strips humanization globally — there is no per-tool hold-out.
- Do not adjust distributions to "speed up" a flow. If a flow is too slow, redesign the flow (skip an interaction, change the persona's typing speed via locale), not the distribution.
- Do not use `click_at` for stealth interactions. It bypasses the humanized cursor path; reserve for visual debugging.

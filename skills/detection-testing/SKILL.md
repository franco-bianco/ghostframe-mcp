---
name: detection-testing
description: Verify the stealth config against public bot detectors. Use after changing launch flags, polyfills, persona, or humanization defaults; before shipping a config change; or as the next step when `stealth-launch` flagged a problem. Manual visual review of detector pages — not an automated test suite.
---

# Detection testing

Sweep four public detector pages in order. Each tests a different signal mix; the union covers most of the layers in [`docs/detection-signals.md`](../../docs/detection-signals.md).

## Default scope

Operates on the currently selected page. Apply your persona via `emulate` _before_ starting the sweep — detectors that recognize a clean stock-Chrome fingerprint will not flag anything, but the test is whether the persona you intend to ship looks human.

## The four detectors

| Detector                | What it tests                                                                   | How to read                                                    |
| ----------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `bot.sannysoft.com`     | Binary pass/fail per signal (webdriver, plugins, languages, WebGL vendor, etc.) | Red rows are fails. Quickest sanity check.                     |
| `arh.antoinevastel.com` | Vastel's combined fingerprint + lie-detection battery                           | Stealth-plugin shape fails here; stock Chrome passes.          |
| `creepjs`               | Fingerprint hashing + "lies" (descriptor mismatches, prototype tampering)       | Look at lies count and trust score. Best after polyfill work.  |
| `pixelscan`             | Commercial-grade fingerprint + IP correlation                                   | Free tier shows partial fails; useful for relative comparison. |

## Workflow

### 1. Apply the persona

```bash
ghostframe emulate --userAgent "<persona UA>" --viewport "<persona viewport>"
```

Bundle locale, timezone, and geolocation through the same `emulate` call (see [`docs/stealth-configuration.md#emulate-bundles-a-persona`](../../docs/stealth-configuration.md#emulate-bundles-a-persona)).

Verify coherence once:

```bash
ghostframe evaluate_script "() => ({
  ua: navigator.userAgent,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  langs: navigator.languages
})"
```

### 2. bot.sannysoft.com

```bash
ghostframe new_page "https://bot.sannysoft.com"
ghostframe take_screenshot --fullPage true --filePath sanny.png
ghostframe take_snapshot --filePath sanny.txt
```

Read `sanny.png` for the test matrix. Common red rows:

- `webdriver` — launch flag leak (`--enable-automation` not stripped).
- `Chrome (New)` — UA inconsistency.
- `Permissions` — `Notification.permission` ↔ `Permissions.query` desync.
- `Plugins length` — zero plugins in headless without polyfill.
- `Languages` — empty or mismatched.
- `WebGL Vendor`, `WebGL Renderer` — software fallback.

For each red row, map to the layer in [`docs/detection-signals.md`](../../docs/detection-signals.md) and the fix in [`docs/stealth-configuration.md`](../../docs/stealth-configuration.md).

### 3. arh.antoinevastel.com

```bash
ghostframe navigate_page --url "https://arh.antoinevastel.com/bots/areyouheadless"
ghostframe take_screenshot --fullPage true --filePath vastel.png
```

Then the broader test page:

```bash
ghostframe navigate_page --url "https://arh.antoinevastel.com/bots"
ghostframe take_screenshot --fullPage true --filePath vastel-bots.png
```

Vastel tests Chrome-specific surface. If `chrome.runtime` polyfill shape is off, this catches it. If the polyfill's `toString` doesn't return `[native code]`, this catches it.

### 4. creepjs

```bash
ghostframe navigate_page --url "https://abrahamjuliot.github.io/creepjs/"
```

CreepJS takes time to compute. Wait for the full page render:

```bash
ghostframe wait_for "trust score"
ghostframe take_screenshot --fullPage true --filePath creep.png
```

Read for:

- **Trust score**. Higher is better. Stock Chrome with no automation is ~80–95.
- **Lies count**. Number of detected prototype/descriptor mismatches. Stock: 0. Stealth-plugin: 5–15.
- **Fingerprint stability**. CreepJS hashes across categories; stable hashes with low lies indicates a clean polyfill.

### 5. pixelscan

```bash
ghostframe navigate_page --url "https://pixelscan.net/fingerprint-check"
ghostframe take_screenshot --fullPage true --filePath pixelscan.png
```

Free tier shows fewer signals than the paid version. Use as relative comparison between config changes — same browser, same persona, same proxy, before vs after.

### 6. Compare and decide

For each detector that flagged, map the failed signal to a layer:

| Detector signal                                | Layer       | Likely fix                                                                       |
| ---------------------------------------------- | ----------- | -------------------------------------------------------------------------------- |
| `webdriver`                                    | Launch      | Strip `--enable-automation`, add `--disable-blink-features=AutomationControlled` |
| `HeadlessChrome` UA                            | Launch      | Apply persona via `emulate`                                                      |
| `chrome.runtime` shape                         | DOM         | Update polyfill to track Patchright                                              |
| WebGL software vendor                          | Fingerprint | Run on GPU host or apply WebGL polyfills                                         |
| Timezone / locale mismatch                     | Fingerprint | `emulate` with locale + timezone bundled                                         |
| `webdriver` descriptor present (value `false`) | DOM         | Remove descriptor at `addScriptToEvaluateOnNewDocument` time                     |
| Lies > 0 in CreepJS                            | DOM         | Polyfill leaks; check `Function.prototype.toString` proxy                        |

## Tips

- Capture screenshots, not just snapshots. Detector results are visual; the matrix layout matters for triage.
- Run the sweep in this order. Sannysoft is fast and cheap; pixelscan can be slow.
- Compare to a baseline: run the sweep with the global humanization off-switch in both states, with the persona on and off, and with the polyfills disabled and enabled. Build a relative picture, not an absolute pass/fail.

## What NOT to do

- Do not treat any single detector as ground truth. They overlap but don't agree on every signal.
- Do not chase a single red row by editing only that polyfill. Map to the layer first; the layer fix often resolves multiple rows.
- Do not run the sweep against production targets. Use the four detectors named above; they are publicly maintained for this purpose.
- Do not skip the persona step. A stock-Chrome run will pass the detectors but tells you nothing about the persona you intend to ship.

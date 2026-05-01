# Detection Signals

A concepts page. The six layers a bot detector watches, what each layer measures, what we control, and what we cannot.

Configuration that responds to these signals lives in [`stealth-configuration.md`](./stealth-configuration.md). This page is the *why*.

## Signal layers

A detector composes a verdict from multiple layers. A single layer rarely flips the verdict; coherence across layers does.

| Layer | What it measures | Where we mitigate |
|---|---|---|
| CDP | Whether the browser has CDP attached and what domains are enabled | `docs/stealth-configuration.md#cdp-routing` |
| Launch | Process flags, command-line shape, parent process | `docs/stealth-configuration.md#browser-launch` |
| DOM | JS-visible objects, properties, and method shapes | `docs/stealth-configuration.md#dom-polyfills` |
| Fingerprint | UA, UA-CH, Intl, navigator, WebGL, canvas, audio | `docs/stealth-configuration.md#fingerprint-coherence` |
| Behavioral | Mouse paths, key cadence, scroll, focus changes | `docs/stealth-configuration.md#humanized-input` |
| Network | TLS handshake, JA3/JA4, HTTP/2 settings, header order | Inherited from Chrome via CDP — see [Network](#network-layer) |

## CDP layer

A browser with CDP attached can be detected by the side effects of common CDP enables, not by the protocol itself.

The classic signal: `Runtime.enable` opens a wire-protocol contract that materializes side effects in JS — primarily the way exceptions and console events surface, and the timing of stack-trace collection. A detector probes this without the script seeing the protocol directly.

Examples:

- A `console.debug(obj)` that triggers a `Runtime.consoleAPICalled` event will, when CDP is observing, evaluate the formatter on the inspected object. A getter on a property of `obj` runs.
- `Runtime.exceptionThrown` listeners cause the engine to format thrown errors differently.

References:

- [How to fix Runtime.Enable CDP detection](https://rebrowser.net/blog/how-to-fix-runtime-enable-cdp-detection-of-puppeteer-playwright-and-other-automation-libraries) — the canonical writeup of the `Runtime.enable` getter-trap detection.
- [Castle: a classic CDP detection signal stopped working](https://blog.castle.io/why-a-classic-cdp-bot-detection-signal-suddenly-stopped-working-and-nobody-noticed/) — Chrome quietly changed the surface; the cat-and-mouse continues.
- [CDP fingerprinting](https://svebaa.github.io/personal/blog/cdp-fingerprinting/) — broader survey of CDP-side detection vectors.

Mitigation in this fork: gate the Universe (`src/DevtoolsUtils.ts:142-156`) so `Runtime.enable`/`Debugger.enable` are not held open. Trade-off: lose DevTools-frontend Universe affordances. Two residual implicit enables exist via Puppeteer console listeners — see [`stealth-configuration.md`](./stealth-configuration.md#the-universe-gate).

## Launch layer

What process flags Chrome was started with. Some are visible to JS, some only to the OS, but several leave JS-visible side effects.

Examples:

- `--enable-automation` flips `navigator.webdriver` to `true`.
- `--headless` (legacy) embeds `HeadlessChrome` in the UA. The new headless mode is harder to fingerprint at the UA level but still distinguishable via media codec support and feature flags.
- `--disable-blink-features=AutomationControlled` removes the `webdriver` flag — its absence is the detection vector.
- `--no-sandbox` is not directly probed, but `--single-process` is (`crossOriginIsolated` shape).

References:

- [DataDome: detecting Selenium Chrome](https://datadome.co/threat-research/detecting-selenium-chrome/) — flag-by-flag detection of automation frameworks.
- [Alterlab: scraping Cloudflare-protected sites](https://alterlab.io/blog/scrape-cloudflare-protected-sites) — practical writeup of which flag combinations get past which products.
- [Patchright (Kaliiiiiiiiii-Vinyzu/patchright)](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) — the reference for our launch-flag posture and DOM polyfill shapes.

Mitigation: see [`stealth-configuration.md#default-flag-posture`](./stealth-configuration.md#default-flag-posture).

## DOM layer

What the page sees in the JS environment. Every value, prototype, and method shape is fair game.

Examples:

- `navigator.webdriver`
- `navigator.plugins.length === 0` in headless
- `chrome.runtime` absent in non-extension contexts (real Chrome leaves this populated)
- `WebGLRenderingContext.getParameter(UNMASKED_RENDERER_WEBGL)` returning `SwiftShader` or `Google Inc. (Google)` (software renderer in headless)
- `Notification.permission === 'denied'` while `Permissions.query({name:'notifications'}).state === 'prompt'` — incoherence
- `Function.prototype.toString.call(navigator.permissions.query)` returning a non-`[native code]` string (i.e. the polyfill leaks)

### The arms-race caveat

DOM polyfills are detected by their *shape*, not by their absence. A polyfill of `chrome.runtime` is itself a fingerprint: the property descriptor, prototype chain, enumeration order, getter behavior, and `toString` output are all probed.

Stealth-plugin (`puppeteer-extra-plugin-stealth`) is at this point fingerprinted across the industry. Patchright is the current reference. Expect Patchright's shape to be detected eventually; track upstream and update.

Concretely, polyfills we ship and maintain:

- `chrome.runtime`, `chrome.loadTimes`, `chrome.csi`
- `Notification.permission` ↔ `Permissions.query` coherence
- WebGL `UNMASKED_VENDOR_WEBGL` / `UNMASKED_RENDERER_WEBGL` returning hardware-plausible strings
- `Function.prototype.toString` Proxy preserving `[native code]` for polyfilled functions

References:

- [How sites detect headless browsers (2026)](https://dev.to/vhub_systems_ed5641f65d59/how-sites-detect-headless-browsers-and-how-to-evade-each-signal-2026-guide-2jj0) — current per-signal map.
- [DataDome: how new headless Chrome and the CDP signal are impacting bot detection](https://datadome.co/threat-research/how-new-headless-chrome-the-cdp-signal-are-impacting-bot-detection/) — the DOM/CDP boundary, vendor view.

## Fingerprint layer

Stable cross-session attributes that compose into an identifier.

Examples:

- UA string and UA-CH metadata
- `navigator.languages`, `navigator.platform`, `navigator.hardwareConcurrency`, `navigator.deviceMemory`
- `Intl.DateTimeFormat().resolvedOptions().timeZone` and `.locale`
- `screen.width/height`, `screen.colorDepth`, `window.devicePixelRatio`
- WebGL renderer vendor, supported extensions
- Canvas hash, audio hash
- TLS / JA4 (covered under [Network](#network-layer))

The detection is rarely "this canvas hash is bot." It is "this canvas hash, with this UA, with this timezone, with this proxy IP, is incoherent."

References:

- [Cloudflare: JA3/JA4 fingerprinting](https://developers.cloudflare.com/bots/additional-configurations/ja3-ja4-fingerprint/)
- [DataDome: Picasso for device-class fingerprinting](https://datadome.co/threat-research/the-art-of-bot-detection-picasso-for-device-class-fingerprinting/)
- [proxies.sx: TLS fingerprint](https://www.proxies.sx/use-cases/privacy/tls-fingerprint)
- [JA4 client fingerprinting](https://deveshshetty.com/blog/ja4-client-fingerprinting/)

Mitigation: persona-coherent `emulate` (see [`stealth-configuration.md#fingerprint-coherence`](./stealth-configuration.md#fingerprint-coherence)).

## Behavioral layer

How the page is *used*. Mouse paths, key timings, scroll deltas, focus changes, time-on-page.

Examples:

- Cursor reaches target in one frame (no `mousemove` events between origin and target).
- All inter-key intervals are 0 ms (`page.keyboard.type` default).
- Scroll deltas are uniform.
- No `focus`/`blur` events between form fields.
- No `selectionchange` while typing.

References:

- [Castle: from puppeteer-stealth to nodriver](https://blog.castle.io/from-puppeteer-stealth-to-nodriver-how-anti-detect-frameworks-evolved-to-evade-bot-detection/) — recent vendor view of the framework arms race.
- [PMC: human keystroke timing distributions](https://pmc.ncbi.nlm.nih.gov/articles/PMC8606350/) — empirical distribution data referenced by the humanization defaults.
- [CDP-Patches](https://github.com/Kaliiiiiiiiii-Vinyzu/CDP-Patches) — input dispatched at CDP level rather than CDP-Input level.
- [hCaptcha: why classic browser fingerprinting no longer stops bots](https://www.hcaptcha.com/post/why-classic-browser-fingerprinting-no-longer-stops-bots) — the shift from fingerprinting to behavioral.

Mitigation: humanized input defaults in [`stealth-configuration.md#humanized-input`](./stealth-configuration.md#humanized-input).

## Network layer

TLS handshake (JA3/JA4), HTTP/2 SETTINGS frame, header order, ALPN negotiation. These are *not* MCP-controllable in any meaningful way.

Stance: this fork inherits Chrome's network stack via CDP. Chrome speaks TLS, not us. As long as we drive a real Chrome binary, our JA4 is Chrome's JA4. This is a stealth feature.

Caveats:

- A proxy that terminates and re-originates TLS (most authenticated forwarders) replaces Chrome's JA4 with the proxy's. A pure-pass-through proxy preserves it.
- `Network.setExtraHTTPHeaders` rewrites headers but does not reorder them at the wire level. Reordering would require a custom transport, which we do not ship.

Out of scope to mitigate further. Document the constraints; route stealth-sensitive traffic through pass-through proxies.

## Detector tools we use to verify

Public detector pages. Run after any change to launch flags, polyfills, persona, or humanization.

- `bot.sannysoft.com` — binary pass/fail per signal. Quickest sanity check.
- `arh.antoinevastel.com` — Vastel's richer test set. Stealth-plugin shape is detected here.
- `creepjs` — combined fingerprint plus "lies" detection; best after polyfill work.
- `pixelscan` — commercial-grade. Free tier shows partial fails; useful for relative comparison.

Operational guide: [`skills/detection-testing/SKILL.md`](../skills/detection-testing/SKILL.md).

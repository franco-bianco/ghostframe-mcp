# Design Principles

Guidelines for shipping features in this stealth fork. Apply with nuance — when a stealth principle and a general principle disagree, stealth wins.

## General principles (inherited)

- **Agent-agnostic API**: Use MCP. Do not lock to one LLM. Interoperability is non-negotiable.
- **Token-optimized**: Return semantic summaries. "Detected on creepjs (lies: 3)" beats 50k of fingerprint JSON. Files are the right home for large data.
- **Small deterministic blocks**: Composable tools (`click`, `evaluate_script`), not magic buttons.
- **Self-healing errors**: Errors carry context and a next-step. A failed click that returns "no element with uid X — take a fresh `take_snapshot`" is the goal shape.
- **Human and agent readable**: Structured payloads for machines, summaries for humans.
- **Reference over value**: Heavy assets (screenshots, traces) return a path or resource URI, not the raw bytes.

## Stealth principles (specific to this fork)

- **Detection-signal awareness**: Every code change is a signal change. Before adding a CDP domain enable, a new launch flag, or a `Runtime.evaluate` call, ask which detection layer it touches (CDP, launch, DOM, fingerprint, behavioral, network) and whether it adds entropy or removes it. See `docs/detection-signals.md`.
- **Fingerprint coherence**: User-agent string, UA-CH metadata, `Accept-Language`, `navigator.platform`, `Intl.DateTimeFormat().resolvedOptions().timeZone`, viewport, and proxy egress IP must agree. A change to one is a change to all. The `emulate` tool bundles persona attributes into one coherent change.
- **Do no harm to entropy**: Do not introduce constants where the stock browser has variance. Hardcoded screen sizes, fixed viewport, uniform input timings, and zero-delay typing are bot tells. Default to plausible distributions; expose a single global off-switch for tests, not per-call overrides.
- **Isolated by default for agent eval**: Scripts the agent injects run in an isolated world. Code the user explicitly hands to `evaluate_script` defaults to isolated and may opt into main world. The DevTools-MCP `Universe` (which keeps `Runtime.enable` + `Debugger.enable` open) is gated off in stealth mode and the affordances it provides are forfeit. See `docs/stealth-configuration.md`.
- **Polyfills are arms-race**: DOM polyfills (`chrome.runtime`, permissions coherence, `Function.prototype.toString`) are detected by their _shape_, not their absence. Track an upstream reference (Patchright) and expect to maintain. See `docs/detection-signals.md`.
- **Inherit Chrome's network stack**: TLS, JA3/JA4, and HTTP/2 fingerprints come from real Chrome via CDP. Do not interpose. This is a stealth feature, not a limitation.
- **One persona per session**: Mixing UA, locale, and timezone within a session is a stronger tell than any single mismatched value. Pick a coherent set and hold it.
- **Tool surface stays narrow**: Every tool is a code path detectors can probe. Lighthouse, heap snapshots, and performance tracing are out of scope for this fork — they require CDP domains that leak. Reject feature requests that re-add them.

## Trade-offs documented inline

- Stealth mode loses DevTools-frontend Universe affordances (CDP-frontend probing). This is the cost of not pinning `Runtime.enable` open.
- Humanized input is slower than instant input. For tests that don't need stealth, the global off-switch exists.
- Polyfilling `chrome.runtime` to Patchright shape will outdate when Chrome changes the surface. Expected. Update the reference, not the heuristic.

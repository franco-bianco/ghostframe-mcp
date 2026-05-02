---
name: borrow-stealth-feature
description: Port a single feature from a reference stealth project into this fork's TypeScript code. Use when you've identified a needed mitigation in `vibheksoni/stealth-browser-mcp`, `nodriver`, or another reference repo and need to bring it across without copy-pasting unsafe patterns. Teaches the workflow; the seed examples are starting points, not a static port list.
---

# Borrow a stealth feature

This skill teaches _how to borrow_, not _what to borrow_. Detection signals shift; the borrow targets that matter today differ from the ones that matter next quarter.

The reference repo most directly aligned with our scope is `vibheksoni/stealth-browser-mcp` (Python). Pin to commit `17311be7b0f6b879644c39ec5e8f0dc8a9dd920c` when reading; the project moves fast and `main` may have diverged.

For why each layer matters, see [`docs/detection-signals.md`](../../docs/detection-signals.md).

## Default scope

Operates on this fork's TypeScript source (`src/...`) and is effectively a code-borrow workflow with parity-verification steps. Out of scope for this curator role to actually edit `src/`; this skill is the operational guide an engineer or coding agent follows when the lead approves a port.

## Workflow

### 1. Identify the target signal

Start from a failing detector row, a specific block response, or a `diagnose-bot-block` output. Map to a layer.

If you cannot name the layer in one sentence, stop. Don't borrow a feature whose purpose you can't articulate — porting unprincipled features adds entropy without removing detection.

### 2. Find the reference implementation

Search the reference repo for the target. Prefer:

- A Python file under `src/` of `vibheksoni/stealth-browser-mcp` that addresses the layer in isolation.
- A `nodriver` README section that names the technique.
- A specific commit on `Kaliiiiiiiiii-Vinyzu/patchright` that introduces the polyfill or flag.

Read the source, not just the README. Read the commit message and any linked issue.

### 3. Classify the port

For each candidate, decide:

| Classification   | Meaning                                                                             | Action                                                        |
| ---------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Port-as-is       | TS-equivalent semantics, low integration risk                                       | Translate Python → TypeScript line-by-line, preserve comments |
| Adapt-for-TS     | Behavior identical but Python idiom doesn't map (dynamic types, `exec`, decorators) | Rewrite in idiomatic TS; cite the source for parity reference |
| Use upstream npm | Equivalent npm package exists                                                       | Use the package; do not re-implement                          |
| Don't port       | Source has a footgun (see [Negative examples](#negative-examples))                  | Leave it. Document why in the port PR                         |

### 4. Implement with parity in mind

When porting, capture for each function:

- The exact CDP method called (e.g. `Network.setBlockedURLs`, `Page.addScriptToEvaluateOnNewDocument`, `Network.setExtraHTTPHeaders`).
- The exact polyfill string injected, byte-for-byte if possible. Polyfills are detected by their _shape_; reformat carefully.
- The order of operations. Many stealth techniques are order-sensitive (e.g. `addScriptToEvaluateOnNewDocument` must run before any navigation).

### 5. Verify parity

Before the port lands, verify:

- Detector sweep passes the layer the borrow targets. Run `skills/detection-testing/` before and after; confirm the row that was red is now green.
- The borrowed feature does not regress another layer. CreepJS lies count must not increase. UA coherence checks must still match.
- The behavior matches the source on a test page. If the reference repo ships a fixture, run against it.

### 6. Document the maintenance contract

Add to the port PR description:

- The reference commit hash (Python or upstream).
- The detection signal addressed.
- The expected lifetime — "Patchright shape, expect to revisit when Chrome changes the API."
- Detector-page observation: which detector row flipped from red to green.

## Seed examples (high-value targets, not exhaustive)

From `vibheksoni/stealth-browser-mcp` at the pinned commit:

| Feature                                                    | Source path                        | Layer addressed                | Classification                                                                     |
| ---------------------------------------------------------- | ---------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| `Network.setBlockedURLs`                                   | `src/network_interceptor.py:43-77` | Network                        | Port-as-is                                                                         |
| `Network.setExtraHTTPHeaders`                              | `src/server.py:965-984`            | Fingerprint (header coherence) | Port-as-is                                                                         |
| `Page.addScriptToEvaluateOnNewDocument` polyfill injection | `src/server.py:2440-2461`          | DOM                            | Port-as-is, but treat each polyfill as a separate borrow with its own parity check |
| Authenticated-proxy forwarder                              | `src/proxy_forwarder.py:1-439`     | Network (auth proxy support)   | Use upstream npm — `proxy-chain` covers this without rewriting 400 lines           |

## Negative examples

Do not port these. The reason they exist in the reference does not generalize to TS.

| Source                                                                    | Why not                                                                                                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dynamic_hook_ai_interface.py`, `hook_learning_system.py`                 | AI-codegen executing `exec()` of LLM-generated Python. We are TypeScript; eval'd-string injection paths are a code-injection footgun without an equivalent runtime sandbox |
| `--single-process` container heuristic                                    | The flag itself is detectable via `crossOriginIsolated` shape. Borrowing it adds detection signal                                                                          |
| `nodriver`'s default `--disable-features=IsolateOrigins,site-per-process` | Cloudflare BM Enterprise probes `crossOriginIsolated`; inheriting this default adds signal                                                                                 |

## Tips

- Borrow one feature per PR. Mixing two unrelated mitigations makes parity verification ambiguous.
- Capture the detector matrix before and after. The PR description should show the row that changed.
- Read the linked issue or commit message in the reference repo. Stealth code is full of "obvious-looking" patches that exist for non-obvious reasons.
- When the source is a polyfill string, preserve its exact whitespace and identifier names. Detectors fingerprint the polyfill source; reformatting changes the fingerprint.

## What NOT to do

- Do not bulk-port "the stealth file" from the reference repo. Each feature has its own trade-off; borrow incrementally.
- Do not skip the negative-examples list. Two of those entries are _more_ detectable than the inherited posture.
- Do not port a polyfill you don't understand. If you can't articulate which detector row it fixes, you can't tell when it stops working.

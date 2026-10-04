# Feature priorities

Prioritize evidence and control that an agent cannot obtain from existing tool results.
Rank features by the blocked website flows they unlock and the reliability of their browser boundary.
Do not rank features by tool count or generated output volume.

## Implemented capabilities

| Order | Capability                                | New evidence or control                                                               | Implementation                                                                 |
| ----- | ----------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1     | Change the proxy after launch             | Change egress while retaining the browser session.                                    | Native Chrome proxy settings through a private extension.                      |
| 2     | Durable network capture                   | Retain response bodies before navigation, closure, or browser eviction.               | Page CDP events, eager body files, journal, limits, and explicit gaps.         |
| 3     | Controlled request and response changes   | Change the original request or its response inside a real website flow.               | Scoped CDP Fetch interception with deadlines.                                  |
| 4     | Recoverable browser actions               | Inspect or release a pause while the action remains pending.                          | Background operations, target locks, and explicit cancellation.                |
| 5     | Runtime objects and retained functions    | Inspect closures and engine properties; invoke the original function.                 | Target, frame, and world selection with expiring remote handles.               |
| 6     | Scoped debugging and live source          | Observe the code path, paused scopes, handlers, and generated scripts.                | Opt-in Debugger sessions, breakpoints, source retention, and automatic resume. |
| 7     | Privileged session state and live traffic | Inspect HttpOnly cookies, partitioned storage, WebSocket messages, and event streams. | Browser-context cookies, storage-key queries, and network stream events.       |

Proxy switching ranks first because launch-only proxy configuration was a concrete workflow blocker.
Capture and interception follow because they expose evidence and experiments that ordinary page evaluation cannot reconstruct later.
Recoverable actions support interception and debugging; they must ship with those controls.
See [the investigation guide](investigation.md) for supported operations and limits.

## Chrome areas and remaining work

These areas can supply further capabilities.
Their priority reflects the current implementation gaps, rather than a promise of complete browser visibility.

| Area                                 | Available interface or reusable code                                                                                                                                    | Current result                                                                            | Next useful investigation                                                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network service and proxy settings   | [Chrome proxy API](https://developer.chrome.com/docs/extensions/reference/api/proxy) and [CDP Network](https://chromedevtools.github.io/devtools-protocol/tot/Network/) | Live endpoint changes and decoded page traffic.                                           | Verify how to retire existing sockets and clear cached proxy authentication without restarting. Highest priority for strict egress rotation.                  |
| Target and frame lifecycle           | [CDP Target](https://chromedevtools.github.io/devtools-protocol/tot/Target/) and Puppeteer frame sessions                                                               | Explicit worker evaluation and frame selection. Capture remains on page primary sessions. | Add opt-in worker and out-of-process iframe capture. Deduplicate events and preserve target identity across navigation. Highest priority for missing traffic. |
| V8 runtime and debugger              | [CDP Debugger](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/) and existing DevTools source utilities                                                 | Retained closures, function scopes, generated source, and scoped pauses.                  | Reuse source-map and authored-scope support where it exposes unavailable names or locations. Optimized-away values remain an engine limit.                    |
| Blink event dispatch                 | CDP DOMDebugger and existing DevTools event-listener support                                                                                                            | Actual listener handles and event breakpoints.                                            | Identify delegated handlers and asynchronous causes only where current handles and stacks cannot expose them. Validate against actual event dispatch.         |
| Browser storage and network fidelity | CDP Storage, IndexedDB, CacheStorage, and Network extra-info events                                                                                                     | Privileged storage and normalized header evidence.                                        | Add partition-aware cache variants and broader traffic diagnostics when a real flow needs them. Exact wire headers require a separate fidelity boundary.      |

The current features require no Chrome binary reverse engineering or Chromium fork.
Use CDP and existing DevTools packages before copying browser source.
Chromium network-service code depends on browser infrastructure; copying a component does not make it a standalone Node package.
If public interfaces cannot satisfy strict socket or authentication control, evaluate a local relay before considering a maintained browser patch.
The relay must preserve Chrome's destination TLS behavior and report traffic it cannot route.

Source-map presentation and API artifact generation can reuse accumulated evidence.
They rank below capabilities that collect missing evidence or change an otherwise inaccessible browser operation.

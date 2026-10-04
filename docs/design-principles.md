# Design principles

Ghostframe helps agents understand website flows and reproduce frontend API behavior.
It provides browser evidence and browser controls through MCP and a CLI.
See [feature priorities](feature-priorities.md) for implemented capabilities and remaining browser boundaries.

## Add capabilities that expose new evidence or control

Add a tool when existing tool output cannot supply the required evidence or action.
Examples include a retained closure, an actual paused response, or a live proxy change.
Do not add tools that only repackage evidence an agent can already analyze.

Keep tools small and composable.
Use explicit target, frame, realm, and storage identities where they affect correctness.
Return references for large bodies and remote objects.
Bound retained state and report missing data.

## Reuse Chrome and Puppeteer

Use existing CDP commands, Puppeteer APIs, and DevTools helpers before adding browser code.
These interfaces expose network events, runtime objects, listeners, debugging, and browser storage.
The proxy controller uses a private extension and Chrome's proxy API.
These features do not require a Chromium fork.

Keep Chrome responsible for origin connections and browser protocol behavior.
Do not reconstruct its TLS or HTTP stack in application code.
If a future capability requires a relay, document which connections it owns and which traffic it cannot route.

## Keep the default observation path small

Use the page's existing CDP session for passive capture where possible.
Do not enable Debugger or attach to every worker at startup.
Do not introduce page globals for investigation state.
Run injected evaluation in an isolated world by default.

Some investigations require behavior that changes the runtime.
Enable those controls only when the caller requests them.
Use a specific target, a deadline, and deterministic cleanup.
Explain detection and timing effects in the tool description.

The scoped debugger is an explicit exception to the default passive posture.
Request interception also changes network timing.
Neither feature guarantees stealth.
See [investigation workflows](investigation.md) and [detection signals](detection-signals.md).

## Preserve coherent browser state

Keep the user agent, client hints, language, platform, timezone, and viewport consistent.
Proxy egress can change the website's view of the session.
Changing the proxy does not automatically change the browser persona.

Use the existing human input helpers for agent input.
Keep plausible timing variation in production.
Tests can use the existing global stealth switch.

Treat DOM polyfills as compatibility code that needs maintenance.
Check their shape against the chosen upstream reference when Chrome changes.
See [stealth configuration](stealth-configuration.md).

## Make pauses recoverable

Arm observations and interceptions before triggering traffic.
Start actions that can pause through `start_action`.
Return an operation ID immediately so another tool can inspect or release the pause.
Do not hold the MCP tool mutex while an action waits for debugger or interception input.

Resume and disable debugger sessions at their deadlines.
Continue untouched intercepted traffic when its deadline expires.
Reconstruct a complete consumed response body; abort an incomplete consumed body.
Report action observation expiry separately from actual browser execution.
Explicit cancellation can terminate unrelated JavaScript in the same target; describe that effect.

## Document what tests establish

Test the browser behavior a feature promises.
For proxy changes, verify the route and retained session state.
For interception, verify the original request and the page-visible response.
For runtime handles, verify closure behavior and invalidation after navigation.
For capture, verify durable files, bounds, streams, and explicit gaps.

Follow [the documentation guidelines](documentation-guidelines.md) when writing instructions and limits.

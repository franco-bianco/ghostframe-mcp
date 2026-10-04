# Test audit

This audit applies [the testing policy](testing-policy.md) to the current repository.
It accompanies the website investigation implementation and the requested test cleanup.

## Intended behavior and evidence

The requested deliverable is browser evidence and control for website flows and frontend APIs.
The README, investigation guide, tool schemas, MCP response interfaces, and affected source define its observable behavior.
The CLI guide defines daemon and profile behavior.
Project instructions require the full test suite and formatting checks before completion.

Confirmed requirements include page selection, real browser actions, scoped state, durable capture, request mutation, and recoverable pauses.
File roots, symlink handling, credential redaction, deadlines, and bounded retained state protect important failure cases.
Compatibility includes the existing ordinary tool names, MCP responses, CLI argument conventions, and default browser behavior.

Private helper names, response setter calls, incidental prose, and the exact number of tests are not product requirements.
An unchanged test and implementation do not independently justify a contract.

## Baseline and iteration findings

The workspace was clean before implementation.
A separate executable baseline was not run before the feature work.
This limits attribution of unrelated failures; the audit does not classify them as new defects without evidence.

The first broad run found an alert-dialog hang and a new worker fixture startup race.
The worker fixture evaluated state before the worker announced readiness.
The alert path waited for browser commands while an unhandled alert blocked execution.
An ordinary action must report the dialog and let the next MCP call handle it.
That requirement follows from the existing dialog tools and blocked-action contract.

After the hang was corrected, old dialog snapshots failed on quoted page text and structured response data.
Those outputs already existed before this feature work.
The audit replaces the whole-output snapshots with public behavior checks instead of accepting new snapshots as requirements.

## MCP dispatcher audit

| Existing check                                    | Classification           | Reason and retained protection                                                                                                                                                                     |
| ------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calls a tool` and `calls a tool multiple times`  | REPLACE                  | Identical page-text snapshots did not prove continuity. One journey now opens a page and confirms its state and earlier page IDs across calls.                                                     |
| `has all tools`                                   | REWRITE                  | Importing every implementation file reproduced internal registration assumptions. Explicit required capabilities, excluded features, page selection, and category filtering now form the contract. |
| Roots change notification                         | KEEP                     | Checks the actual MCP notification/request boundary.                                                                                                                                               |
| Empty roots reject external output                | KEEP, REWRITE assertions | Retains the access rejection and structured error contract without exact prose.                                                                                                                    |
| Missing roots capability permits temporary output | REWRITE                  | Reads the actual saved PNG signature instead of trusting a success message. Uses and removes a unique temporary directory.                                                                         |
| Three dialog snapshots                            | REPLACE                  | Two journeys cover reporting, blocked actions, handling, resumed actions, and opening another page during an alert. These checks do not depend on text layout.                                     |
| `index.test.js.snapshot`                          | DELETE                   | All five snapshots are replaced by the above contracts.                                                                                                                                            |
| `tools/slim/tools.test.js.snapshot`               | DELETE                   | No test source or slim tool registration remains. Retained script, navigation, and dispatcher journeys protect the current capabilities.                                                           |

The dispatcher checks use actual MCP stdio and Chrome.
They establish protocol wiring and recovery, rather than mocked tool return values.

## Production defects identified by stronger checks

The browser tool audit replaces a mocked Offline assertion with a real fetch attempt.
That request succeeded while the tool reported Offline.
Later emulation created and detached a separate CDP session to clear geolocation.
That session boundary reset the requested network state.
The implementation now clears geolocation on the primary frame session.
The expected failed fetch follows from the public Offline option, rather than from either implementation.

The CLI serializer round trip lost Chrome flags whose values begin with `--`.
Those values now travel as attached option values, so the daemon parser retains them.
The independent expected values come from documented CLI examples and the initial public parser result.

The real profile restart check exposed lost local storage after CLI shutdown.
The MCP entry point now awaits controller cleanup and `Browser.close()` on signals and input closure.
Puppeteer's competing signal handlers are disabled for the owned browser.
The existing promise to retain storage in an explicit profile defines the expected result.

A never-ending HTTP response exposed an unbounded DOM observer setup.
The stability deadline now includes acquiring its execution context.
An action that opens an alert releases the foreground call so `handle_dialog` can complete the flow.
Both failures occurred at browser boundaries that mock calls could not verify.

Cancelling a breakpoint-paused action previously waited for termination while V8 remained paused.
Cancellation now sends termination and debugger resume together.
The real MCP journey checks cancellation and a later successful evaluation.
That protects the documented recoverable-pause contract and the shared tool queue.
It also releases the retained function while paused and confirms that cancellation still controls the original execution realm.
Cancellation keeps its execution session instead of resolving a handle that the caller can release.

Response body inspection used to await the entire body inside the tool queue.
An endless stream could prevent the next call from cancelling its pause.
Body inspection now starts a bounded stream reader and returns progress.
Native stalled-response checks verify cancellation, byte limits, and safe response ownership.
Once a body is consumed, an incomplete response must be aborted rather than continued unchanged.
The investigation guide documents that exception to the ordinary interception deadline.

Shutdown also waits for pending context initialization and rejects new acquisitions after shutdown begins.
The owned browser closes before the proxy extension is removed.
This preserves the configured route until Chrome exits and still removes the extension's temporary files.

One rewritten file test initially used the parent's temporary directory while the SDK child used a different default.
The fixture now supplies the same temporary-directory environment explicitly.
The filesystem access rule was unchanged.

The first clean bundle followed by a full run found two fixture assumptions.
Browser fixtures imported a separate Puppeteer copy while Ghostframe used its bundled copy.
Their frame instances therefore failed the correct CDP-frame check.
The shared fixture now launches the Puppeteer implementation exported by Ghostframe.
It still uses real Chrome and requires no production exception.
The obsolete test-only Locator override is removed; browser and locator instances now come from the same production module.

The new notices assertion required license text in every generated package entry.
The existing Rollup template explicitly permits a missing `licenseText` value.
The check now requires package identity and license metadata, copied text for manual entries, and the available license texts in the artifact.
This corrects the test using the packaging contract; the bundle implementation is unchanged.

## Investigation feature audit

| File                             | Classification            | Observable risk protected                                                                                                                                                                 |
| -------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NetworkCapture.test.ts`         | KEEP, REWRITE headers     | Durable bodies and events, explicit missing data, complete header values, byte limits, cursor reads, live waits, future tabs, and streaming protocols.                                    |
| `ProxyController.test.ts`        | KEEP                      | Actual HTTP and CONNECT routes, authentication, no direct fallback, state preservation, profile cleanup, and unsupported rotation behavior.                                               |
| `RuntimeInspector.test.ts`       | KEEP                      | Actual retained closures, listener functions, getter avoidance, realm identity, handle expiry, private state, storage boundaries, generated source, and debugger recovery.                |
| `InterceptionController.test.ts` | KEEP, REWRITE body checks | One original request reaches the server with changed data; response replacement, bounded stream progress, acquisition races, deadlines, and cancellation reach the real browser boundary. |
| `McpOperations.test.ts`          | KEEP                      | Actual dispatcher calls remain available during debugger and interception pauses. Native controller tests cannot detect a held MCP mutex.                                                 |
| `OperationManager.test.ts`       | KEEP                      | Observation expiry does not imply execution stopped; locks use the actual target; cancellation and disposal invoke cleanup. These are distinct lifecycle transitions.                     |

These are integration and contract checks with real browser and filesystem collaborators.
The lifecycle checks isolate state transitions while using a real target identity.
No coverage threshold or target test count was introduced.

## Review before commit

Commit `a1265b0` removed network header redaction while this work was in progress.
The final integration preserves that change.
Capture and interception now also return collected header values in full.
Header checks use that independent requirement instead of the earlier redaction assumption.
Proxy credentials remain excluded from logs and daemon status.

A new interception assertion expected `Set-Cookie` in every paused response.
The browser's Fetch event omitted that header; the controller returns the supplied entries unchanged.
The corrected check verifies a complete custom API header and the actual HttpOnly cookie after response replacement.
Passive capture separately verifies `Set-Cookie` in network evidence.
The tool output and investigation guide report the Fetch header gap instead of claiming complete wire visibility.

The capture header fixture also stopped as soon as page-side fetch completed.
Network extra-info can arrive afterward through an independent event path.
The fixture now keeps collection active while it waits for the required cookie evidence, with a bounded deadline.
Stopping still flushes observed records and pending bodies; it does not promise to collect future events.

The runner's forced exit reported 299 passing tests but omitted 36 retained checks.
A focused run without forced exit executed the missing collector and formatter checks.
The full run then exposed browser fixtures that kept Chrome processes open after testing.
The shared fixture now disposes its context and closes cached browsers in an `after` hook.
The runner no longer forces exit.
All 335 declared cases execute, and process cleanup is part of verification.

## Remaining audit records

See [core and formatter audit](testing-audit-core.md), [browser tool audit](testing-audit-browser.md), and [infrastructure audit](testing-audit-infrastructure.md).
Each record names changes, their independent justification, and replacement checks.

## Limits

Browser tests establish behavior on the installed test Chrome version.
They do not prove universal proxy routing, invisible instrumentation, full worker traffic capture, or exact wire headers.
The investigation guide records those limits.
Untested behavior is reported as a gap, not as a guarantee supplied by a green suite.

## Final verification

- `npm run bundle` passed from a clean build directory. Rollup reported third-party circular-dependency and top-level `this` warnings. It generated the actual dependency notices.
- `npm run gen` passed. Tool references and CLI definitions match the current schemas.
- Focused checks passed for the audited core, browser, infrastructure, and investigation behaviors. They exposed the failures and fixture assumptions recorded above before corrections.
- The final `npm run test` passed all 335 tests, with zero failures, cancellations, or skips. The bundle notices and real FFmpeg decode both ran.
- `npm run format` and `npm run check-format` passed, including TypeScript lint, Markdown lint, and formatting.

The final suite uses real browser, file, daemon, socket, and MCP boundaries where those boundaries carry the risk.
It verifies actual saved bytes, session continuity, original-request mutation, bounded body reads, and recovery after pauses.
Compact representation checks remain where agents depend on IDs, hierarchy, argument encoding, and reference fields.
No production special case was added to preserve an incorrect test expectation.

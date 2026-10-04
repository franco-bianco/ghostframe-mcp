# Browser and tool test audit

This audit applies the [testing policy](testing-policy.md) to browser launch, initialization, and all existing tool tests.
It compares checks with public behavior before it treats existing expectations as requirements.
The cleanup changes tests and their snapshots.
The parent task owns production fixes and final repository checks.

## Sources of intent

The audit reads [README.md](../README.md), [the tool reference](tool-reference.md), and [stealth configuration](stealth-configuration.md).
It also reads the tool schemas, handlers, response formatters, browser launch code, and initialization scripts.
These sources establish page selection, isolated sessions, browser input, optional snapshots, emulation, capture, and dialog behavior.
They do not establish guaranteed stealth, mapped console stacks, or a particular internal helper order.

## Inventory classifications

Each row covers the complete named behavior group in the assigned files.
“Remaining” excludes checks listed as deleted or replaced below.

| File or group                                                                                                        | Classification                         | Behavioral reason                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `tests/browser.test.ts`: profile lock and initial viewport                                                           | KEEP; REWRITE diagnostics and cleanup  | A second browser must not corrupt an active profile. Browser dimensions must match launch options.                          |
| Browser display detection smoke check                                                                                | DELETE                                 | Calling a function without observing a result or failure condition does not establish a contract.                           |
| `tests/init-scripts.test.ts`: native text, runtime object, permission coherence                                      | KEEP; REWRITE titles and type handling | Check the exposed compatibility surfaces without claiming indistinguishability from Chrome.                                 |
| Initialization fallback CSI timing                                                                                   | REWRITE                                | The fallback must preserve the navigation origin while elapsed page time advances.                                          |
| `tests/tools/console.test.ts`: live collection, errors, primitive exceptions, issue collection and reload            | KEEP                                   | Real browser events must reach agent-visible output while stealth remains enabled.                                          |
| Console issue node and request references; open-dialog output                                                        | KEEP                                   | Agents need actionable references and usable output while JavaScript is paused by a dialog.                                 |
| Console list flag check                                                                                              | DELETE                                 | Live collection tests already check the actual output.                                                                      |
| Console source-map and ignore-list snapshots                                                                         | REPLACE; DELETE unsupported claims     | The snapshots contain no mapped frames. Keep Error argument type and message extraction instead.                            |
| `tests/tools/emulation.test.ts`: transform object shapes                                                             | REPLACE                                | Parse the public viewport and location strings, then observe browser APIs. Undefined intermediate fields are incidental.    |
| Emulation network cached settings                                                                                    | REPLACE                                | Observe failed offline fetches, per-page scope, and restored access against a local server.                                 |
| Emulation CPU cached settings                                                                                        | DELETE; performance coverage gap       | Cached factors do not demonstrate slowdown. Keep public range validation without claiming timing coverage.                  |
| Emulation location cached settings                                                                                   | REPLACE                                | Observe requested coordinates through `navigator.geolocation`, including inheritance and updates.                           |
| Emulation viewport, user agent, and color scheme                                                                     | KEEP; REWRITE consolidation            | Observe dimensions, touch, pixel ratio, inherited pages, navigator values, media queries, and resets.                       |
| `tests/tools/input.test.ts`: click paths, double click, navigation, stable DOM, hover, character events              | KEEP                                   | Browser event and DOM observations protect interactive flows and humanized input.                                           |
| Input fill, select, textarea, submission, form isolation, drag, upload and chooser failures                          | KEEP                                   | Actual controls and browser file handling expose mistakes that forwarding mocks miss.                                       |
| Input optional snapshot flags                                                                                        | REWRITE                                | Verify snapshots in the final response and the changed accessible label. Remove redundant setter checks elsewhere.          |
| Input keyboard helper output and key validation                                                                      | REPLACE                                | Drive a literal plus chord through the tool. Reject invalid chords through the same public handler.                         |
| `tests/tools/network.test.ts`: blocking, navigation history, redirect listings                                       | KEEP                                   | Real server requests establish blocking, clearing, retained evidence, and concise request-ID extraction.                    |
| Network list flag check                                                                                              | DELETE                                 | Existing navigation tests already exercise rendered listings.                                                               |
| Network detail attachment flags                                                                                      | REPLACE                                | Verify the POST method, URL, request body, response body, and complete header values.                                       |
| Network old-navigation detail snapshot                                                                               | REWRITE                                | Verify stable identity and status. Do not freeze incidental headers or require Chrome to retain an old response body.       |
| `tests/tools/pages.test.ts`: list flags, creation and selection state                                                | REWRITE                                | Verify public page entries and subsequent evaluation on the requested page.                                                 |
| Pages named-context object identity checks                                                                           | REPLACE                                | Cookies must be shared within a name and isolated across names and the default context.                                     |
| Pages default-context name getter check                                                                              | DELETE                                 | The cookie-isolation check covers default-context separation.                                                               |
| Pages remaining close, background focus, explicit target, navigation and history cases                               | KEEP                                   | Observe browser pages, document contents, focus, closed-page errors, and history outcomes.                                  |
| Pages navigation timeout forwarding mock                                                                             | REPLACE                                | A server that never responds must not keep the navigation tool running indefinitely.                                        |
| Pages initialization script                                                                                          | REWRITE                                | The script must run before page code and stop applying after the requested navigation.                                      |
| Pages open-dialog snapshots                                                                                          | REWRITE                                | Assert page entries, dialog data, navigation contents, and resulting dimensions instead of whole response serialization.    |
| Pages resize states                                                                                                  | KEEP                                   | Real normal, minimized, maximized, and fullscreen windows must produce requested dimensions.                                |
| Pages dialog cached-state and success-string assertions                                                              | REPLACE                                | Observe confirmation and prompt results in owning page JavaScript, including external dismissal and two simultaneous pages. |
| `tests/tools/pagesNavigateAllowlist.test.ts`                                                                         | KEEP                                   | Actual redirect chains establish allow-list acceptance and blocking. Remove an unnecessary arguments cast.                  |
| `tests/tools/screencast.test.ts`: recorder mocks and forwarding                                                      | REPLACE                                | Real FFmpeg recording must produce an MP4 artifact, reject overlap, and permit restarting.                                  |
| Screencast missing executable                                                                                        | KEEP; REWRITE narrow failure injection | Inject failure only at the external recording boundary. Verify actionable installation guidance.                            |
| Screencast no-active-recording and mock stop-state checks                                                            | DELETE                                 | These checks only freeze silent returns or configured mock effects. See the cleanup gap below.                              |
| `tests/tools/screenshot.test.ts`: default, formats, quality, full page, large page, UID, file output                 | REWRITE                                | Check image signatures, actual dimensions, element bounds, and saved image bytes.                                           |
| Screenshot unwritable and malformed paths                                                                            | KEEP                                   | Actual filesystem failures must surface through the tool.                                                                   |
| `tests/tools/script.test.ts`: evaluation, selected page, dialogs, async execution, UID arguments and iframe elements | KEEP                                   | Evaluate actual JavaScript and use actual browser elements.                                                                 |
| Script complex-object case                                                                                           | REWRITE                                | A nonempty nested array must survive serialization. The previous empty-array fixture did not establish that behavior.       |
| Script world selection                                                                                               | REPLACE missing realm evidence         | A page global must remain inaccessible in the default isolated world and accessible in the explicit main world.             |
| `tests/tools/snapshot.test.ts`: snapshot flag                                                                        | REPLACE                                | Return accessible roles, labels, and actionable UIDs from a real document.                                                  |
| Snapshot waiting: existing, any-match, delayed, accessible names and iframe content                                  | KEEP; REWRITE output                   | Check the returned snapshot contents instead of response flags or incidental success prose.                                 |

## Named removals and replacements

| Original check names                                                                                                                | Independent reason                                                                                   | Replacement check                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `detects display does not crash`                                                                                                    | No assertion distinguishes correct detection from an arbitrary return.                               | None. Real launch checks cover the required browser boundary.                                 |
| Console `list messages`; network `list requests`                                                                                    | Setting an inclusion flag does not demonstrate collected evidence.                                   | Existing live console and navigation request listings.                                        |
| Network `attaches request`; `should not add the request list`                                                                       | Attachment state does not demonstrate retrieval.                                                     | `returns the captured method, headers and bodies for a POST request`.                         |
| Five console `applies source maps…` checks; `ignores frames from ignore listed URLs`                                                | Their expected output has no stack frames. These names claim coverage that the tests do not provide. | `returns the type and message of an Error console argument`; existing uncaught-error checks.  |
| Viewport and geolocation `returns undefined for undefined input`                                                                    | Undefined helper results duplicate optional-input plumbing.                                          | Public emulation parsing and browser-visible reset checks where deterministic.                |
| CPU `emulates cpu throttling…`, `disables cpu throttling`, `report correctly…`                                                      | They inspect only cached values.                                                                     | Public CPU range rejection. Actual slowdown remains a coverage gap.                           |
| Network `does not set throttling…`                                                                                                  | The old check bypasses the enum schema with an invalid value.                                        | Public schema rejects `Slow 11G`.                                                             |
| Pages `creates a page in an isolated context`, `reuses the same context…`, `creates separate contexts…`                             | Object identity alone does not demonstrate session isolation.                                        | `shares cookies within a named context and isolates different names and the default context`. |
| Pages `does not set isolatedContext for pages in the default context`                                                               | This freezes a getter rather than session behavior.                                                  | The same cookie-isolation check covers the default context.                                   |
| Pages `respects the timeout parameter`                                                                                              | Forwarding a number to a stub does not establish a bounded operation.                                | `bounds a navigation whose server never responds`.                                            |
| Input `parses keys`, `throws on empty key`, `throws on invalid key`, `throws on multiple keys`                                      | Helper order and direct helper calls bypass the tool boundary.                                       | Actual literal-plus input and handler rejection of invalid chords.                            |
| Screencast `starts…with filePath`, `starts…with temp file`, `errors if…active`, `passes ffmpegPath…`, `stops…reports the file path` | Configured recorder doubles and forwarding calls do not demonstrate video capture.                   | Real FFmpeg lifecycle and MP4 file bytes.                                                     |
| Screencast `does nothing if no recording is active`, `clears the recorder even if stop() throws`                                    | Silent return and configured mock state provide insufficient boundary evidence.                      | Restart after a successful real stop. Failed-process cleanup remains a gap.                   |

The cleanup also removes vacuous inclusion assertions from input and page tests that already observe browser behavior.
It replaces initialization-script casts with runtime type checks.
It removes non-null assertions from touched evaluation and page-ID checks.
It deletes six obsolete console snapshot entries and the page snapshot file after replacing its assertions.
Compact network listing snapshots remain because their request IDs support subsequent tool calls.

## Defects found by independent checks

The offline-fetch replacement exposed a failure at the browser boundary.
The tool reported Offline while a local fetch still succeeded.
A temporary geolocation CDP session reset network emulation when it detached.
The parent task moves geolocation clearing onto the page's primary session.

The stalled-server navigation replacement exposed an unbounded browser evaluation.
The stable-DOM helper waited for a remote handle before it started its timeout.
The parent task bounds handle acquisition and cleans up handles that arrive after cancellation.

The existing beforeunload checks exposed another dialog race.
The stable-DOM helper classified navigation-managed beforeunload dialogs as unhandled.
The parent task corrects that classification while preserving explicit handling for other dialogs.

These checks keep their intended expectations.
The public Offline and timeout contracts establish the expected outcomes.

## Limits and remaining gaps

- Real video validation requires FFmpeg in `PATH`. The test reports a skip if the executable is absent.
- Video coverage verifies a decodable frame and lifecycle behavior. It does not yet reproduce FFmpeg failure during stop.
- CPU validation protects accepted bounds. It does not measure real slowdown under a stable benchmark.
- Location tests observe coordinates, updates, and inheritance. They do not establish host-provider behavior after clearing the override.
- Persona checks do not yet cover locale, timezone, and User-Agent Client Hints coherence across HTTP and JavaScript.
- Console checks protect collected evidence and actionable references. They do not claim source-map translation or ignore-list filtering.
- Screenshot checks protect image format and capture bounds. They do not detect visual rendering regressions.
- The parent audit removes the orphan `tests/tools/slim/tools.test.js.snapshot`, which has no associated test source.

## Verification

Focused runs use the package test script with explicit assigned test paths.
The parent task confirms 77 checks pass across page, emulation, network, and script tests after the production fixes.
The assigned-file run also validates input, console, screenshots, browser launch, initialization, allow lists, snapshots, and real FFmpeg recording.
The strengthened screencast check passes with a real decoded PNG frame; both screencast checks run without skips.
The final repository audit records the required complete-suite and formatting results.

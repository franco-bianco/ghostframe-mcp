# Core and formatter test audit

Apply the [testing policy](testing-policy.md) to future changes.
This audit covers the core, filesystem, and formatter files listed below.
It changes tests and test artifacts only.
It does not change production behavior.

## Evidence and scope

The review used the project instructions, website investigation mission, tool schemas, and current public interfaces.
It read `McpContext`, `McpResponse`, `PageCollector`, `TextSnapshot`, the four formatter implementations, and `utils/files` before changing their checks.
It also read the browser, request, server, and event fixtures.
The review treats existing tests as evidence, not as the source of every requirement.

Confirmed requirements include usable page and request IDs, accessible browser elements, serialized evidence, body files, complete header values, and permitted filesystem access.
Console grouping must retain message identity and prevent unrelated messages from merging.
Snapshot text must expose element IDs, hierarchy, and accessibility attributes.
These requirements support browser flows and frontend API investigation.

## File inventory

| Reviewed file                                       | Classification by behavior                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/McpContext.test.ts`                          | KEEP timeout scaling, DevTools discovery, new-page stealth, cross-page UID resolution, roots, compatibility mode, and symlink escape checks. REWRITE refreshed UID resolution and request serialization. REPLACE mocked body saving with a browser and filesystem check. DELETE helper-selection and roots accessor checks.                  |
| `tests/McpResponse.test.ts`                         | KEEP browser snapshot encoding, snapshot files, UID continuity and reset, network detail encoding, console collection, and issue filtering. REWRITE response-line serialization, page listing, emulation reporting, dialog reporting, network filtering, pagination, and unavailable issue details. DELETE the unused null-snapshot fixture. |
| `tests/PageCollector.test.ts`                       | KEEP main-frame and subframe navigation rules, duplicate subscription protection, page destruction, navigation retention, issue mapping and deduplication, and exception collection. REWRITE request ID checks to include lookup. DELETE two tests covered by the navigation lifecycle case.                                                 |
| `tests/TextSnapshot.test.ts`                        | KEEP both browser tests. They check accessible node IDs and reinsertion of ignored elements with their correct hierarchy.                                                                                                                                                                                                                    |
| `tests/roots.test.ts`                               | KEEP custom-root access with implicit temporary-directory access and rejection outside both. DELETE the duplicate empty-roots case.                                                                                                                                                                                                          |
| `tests/utils/files.test.ts`                         | KEEP extension addition, replacement, unchanged suffixes, directories, hidden files, and compound suffixes. DELETE a mislabeled duplicate.                                                                                                                                                                                                   |
| `tests/formatters/ConsoleFormatter.test.ts`         | KEEP concise and detailed output contracts for arguments, unavailable execution contexts, exceptions, synchronous and asynchronous stacks, causes, ignored frames, and truncation.                                                                                                                                                           |
| `tests/formatters/ConsoleFormatterGrouping.test.ts` | REWRITE grouping checks to assert exported message data. DELETE separate output and singleton checks covered by those cases, plus the trivial empty-array check.                                                                                                                                                                             |
| `tests/formatters/IssueFormatter.test.ts`           | KEEP issue identity, count, title, links, substitutions, affected elements, and invalid-description checks. DELETE unused generic-issue fixture data from the concise case.                                                                                                                                                                  |
| `tests/formatters/NetworkFormatter.test.ts`         | KEEP methods, pending and failed requests, selection metadata, headers, body fallback, missing bodies, large saved bodies, and detailed JSON. REWRITE the inline boundary, saved-file evidence, redirect identities, and status examples. DELETE duplicate file-output cases after consolidation.                                            |
| `tests/formatters/snapshotFormatter.test.ts`        | KEEP compact attribute encoding and JSON hierarchy. REWRITE selected-element guidance and markers without whole-prose snapshots. Use complete snapshot fixtures.                                                                                                                                                                             |

## Named changes and replacements

### Context and filesystem access

- REWRITE `list pages` as `resolves an existing element UID after a refreshed snapshot`. The original name did not describe the behavior. The replacement reads the actual button through its UID before and after refresh. It can detect a stale or misresolved element handle.
- DELETE `should call waitForEventsAfterAction with correct multipliers`. It asserted the chosen helper and its arguments without performing an action or proving a wait. The existing timeout tests still protect the reported scaling rule. They do not prove action-wait completion; that remains a distinct gap below.
- DELETE `can store and retrieve roots`. It checked stored labels. Retained access tests check the effect of roots, including implicit temporary access and symlink escapes.
- REWRITE `should include network requests in structured content` as `serializes request identity and status in structured content`. The replacement checks the external field names and values without stubbing the ID resolver.
- REWRITE `should include detailed network request in structured content` as `serializes an attached request with complete header values`. It checks request identity and the serialized header boundary. The complete bearer token follows the header contract in commit `a1265b0`.
- REPLACE `should include file paths in structured content when saving to file` with `saves actual browser request and response bodies and returns their file paths`. The old formatter stub returned configured strings and did not write files. The replacement issues a real browser POST, resolves its collected ID, saves both bodies through the response handler, and reads both files. It also checks path fields and the omission of inline bodies.
- DELETE `should allow access to os.tmpdir() even if roots are empty` from `roots.test.ts`. `validatePath denies paths outside os.tmpdir() if roots list is empty` in `McpContext.test.ts` already checks both temporary access and outside rejection.
- DELETE `should handle extension without a leading dot`. Its input was `.txt`, so it duplicated the extension-addition case. The public extension type requires a leading dot; the test did not establish another accepted input.

### Response serialization

- REWRITE `allows response text lines to be added` as `serializes response lines in insertion order`. It checks the structured message and the order visible to a caller. It tolerates changes to headings and wrapper text.
- DELETE `does not include anything in response if snapshot is null`. It installed a null-returning snapshot stub but never requested a snapshot. The stub did not affect the result. No new null or error contract replaces this vacuous case.
- REWRITE `list pages` to check the selected page ID and URL in text and structured output. The exact section heading has no effect on page selection.
- REWRITE the seven emulation-reporting cases: network settings present or absent, CPU settings present or at their default, viewport, user agent, and color scheme. They now check schema fields, setting values, and relevant text values. The absent-network case no longer calls `emulate` after it has already serialized the result.
- REWRITE `adds a prompt dialog` and `adds an alert dialog` to check dialog type, message, prompt default, the page-data boundary, and the `handle_dialog` instruction. These checks preserve the information needed to continue a flow without requiring exact prose or punctuation.
- REWRITE `adds image when image is attached` to retain the image content type, MIME type, and data checks. An empty text snapshot adds no image protection. The structured result must still omit image data.
- REWRITE all five network filter cases. They check the exact returned request IDs and exclude filtered IDs from text. The no-match case retains the established omission of the optional `networkRequests` field.
- REWRITE all four network pagination cases. They check exact request IDs, structured page bounds, adjacent page instructions, and invalid-page recovery. Whole-response prose snapshots did not need to be part of that contract.
- REWRITE `throws error if mapping returns null on get issue details` with `assert.rejects`. The former `try/catch` passed if no error occurred. The replacement requires rejection and retains the request's message ID in the error.

### Collection and formatting

- DELETE PageCollector `works` and `clean up after navigation`. `clean up after navigation and be able to add data after` covers collection, the navigation transition, and continued collection. The subframe, subscription, destruction, and retention cases remain separate.
- REWRITE `should assign ids to requests` as `assigns distinct request IDs that resolve to the collected requests`. The replacement checks two distinct IDs, lookup of both requests, and rejection of an unknown ID. Usable IDs are part of the request-detail workflow.
- REWRITE ConsoleFormatter grouping cases for repeated messages, different messages, `A,A,B,A,A`, different types, and different argument counts. They now check message IDs, types, texts, counts, order, and the repeated-message text marker. They do not require the internal grouped subclass.
- DELETE grouping `handles single message`, `toString includes count suffix`, and `toJSON includes count field`. The rewritten repeated and mixed-sequence cases check these outputs together. The singleton in the mixed sequence still has its original ID and no repeat count.
- DELETE grouping `returns empty array for empty input`. It adds no distinct rule beyond the empty collection. The response-level `adds a message when no console messages exist` still checks the caller-visible empty state.
- DELETE the unused generic-issue setup in `formats an issue message`. The concise formatter does not read it. Keep the title, ID, links, and JSON/text contracts, plus the separate detailed affected-element case.
- REWRITE NetworkFormatter `truncates request body` as `keeps request bodies at the inline limit and marks longer bodies as truncated`. The original short body never crossed the limit. The replacement preserves the existing inline boundary at 10,000 characters and checks just above it, including the truncation marker and omitted tail.
- REWRITE `should save bodies to file when file paths are provided` as `saves full bodies and exposes their paths in text and structured output`. It reads actual saved bytes and checks both representations and omission of inline bodies. DELETE `shows saved to file message in toStringDetailed` and `returns file paths in structured detailed data`, which used the same fixture and are now covered together. Keep the distinct large-body preservation case.
- REWRITE `handles redirect chain` as `serializes every redirect with its request identity`. Two distinct redirects can detect a missing hop or reused ID. The replacement checks both text and JSON without requiring the prose layout or defining a new multi-hop ordering requirement.
- REWRITE the three NetworkFormatter status examples as `preserves informational, successful and redirect status codes`. The same status values remain checked in text and JSON. Pending and failed requests remain distinct checks.
- REWRITE snapshot guidance tests as `guides the caller to verbose mode when the selected element is absent`, `does not include a note if the snapshot is already verbose`, and `marks only the selected element in the snapshot`. They check guidance, visible node IDs, and marker placement. They allow edits to explanatory sentences.

## Snapshot artifacts

| Artifact                                                  | Classification and reason                                                                                                                                                                            |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/McpContext.test.js.snapshot`                       | DELETE. Request schema, complete headers, and real saved-file checks replace all three snapshots.                                                                                                    |
| `tests/McpResponse.test.js.snapshot`                      | REWRITE. Remove only entries replaced by the semantic checks above. Keep browser snapshot syntax and hierarchy, saved snapshot contents, network detail encoding, and console serialization entries. |
| `tests/formatters/ConsoleFormatter.test.js.snapshot`      | KEEP. The fixtures encode distinct argument, exception, stack, cause, ignored-frame, and truncation cases in both public representations.                                                            |
| `tests/formatters/IssueFormatter.test.js.snapshot`        | KEEP. They cover title parsing, substitutions, links, affected resources, IDs, and counts in the public issue representation.                                                                        |
| `tests/formatters/NetworkFormatter.test.js.snapshot`      | DELETE. Redirect identity checks replace the sole prose snapshot.                                                                                                                                    |
| `tests/formatters/snapshotFormatter.test.js.snapshot`     | DELETE. Selected-element guidance and marker checks replace its three prose snapshots. Compact attribute syntax and JSON tests remain.                                                               |
| `tests/formatters/HeapSnapshotFormatter.test.js.snapshot` | DELETE. No corresponding test or formatter remains. Heap snapshot tools are outside the retained tool set.                                                                                           |

## Gaps and unresolved assumptions

- UNRESOLVED: no requirement or reproducible browser condition establishes the null-snapshot behavior from the deleted stub. A future observed CDP failure can justify a response-boundary regression test after its intended recovery behavior is defined.
- The action-wait multiplier spy did not prove that an action's effects finish before serialization. A real delayed browser effect is the appropriate level for that behavior. Keep it separate from timeout-value checks.
- The PageCollector event fixture has a no-op `off` method. Retained destruction tests check stored data, not listener removal. A real emitter or browser lifecycle check is needed if listener removal becomes the affected risk.
- Formatter doubles isolate serialization. They do not prove CDP header completeness or wire-byte fidelity. The new real-browser body-file check proves the supported browser-to-file boundary, not universal target coverage.
- Legacy fixture casts and type suppressions remain in unchanged cases. This audit adds none. Replace them with complete typed fixtures when work affects those boundaries; do not change production interfaces only to simplify a mock.

## Verification

The focused package-script run covers all 11 inventoried test files and performs the required TypeScript build.
Its first run found one incorrect new expectation: an empty filter result omits the optional request array.
The test now preserves that existing output contract; production was unchanged.
Focused reruns cover the corrected response tests and the final redirect identity check.
The root integration task owns final formatting and the project-required full test run.

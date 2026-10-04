# Infrastructure test audit

This audit covers CLI parsing, daemon IPC and lifecycle, CLI browser flows,
proxy credential policy, the legacy update helper, and bundled notices.
Expected behavior comes from the [CLI guide](cli.md),
[README launch options](../README.md#configuration), public option schemas,
the socket transport contract, and the bundle's license-generation rules.
Assertions about parser aliases, mocked return values, private call order,
or incidental startup prose do not establish these contracts.

## Inventory and decisions

| Group                                            | Classification       | Decision and evidence                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/cli.test.ts`                              | REWRITE              | Retain documented headed/stable MCP defaults, conservative credential/file settings, explicit profile/executable selection, viewport, repeated Chrome flags and disabled categories. Compare these values directly instead of copying entire yargs objects, aliases and internal `$0`/`_` fields.                                                                   |
| `tests/daemon/utils.test.ts`                     | REPLACE              | Replace five invented `foo`/`bar` serializer examples with a real parser-to-serializer-to-parser round trip using profile paths with spaces, proxy settings, categories, executable selection and repeated Chrome flags. CLI launch actually crosses this boundary.                                                                                                 |
| `tests/daemon/client.test.ts`: lifecycle         | REWRITE              | Consolidate repeated start/stop setup into one real-daemon lifecycle test. Verify idempotent client start preserves the PID and status reports that PID; CLI restart is tested separately. Retain actual status credential redaction with unique secrets.                                                                                                           |
| `tests/daemon/client.test.ts`: IPC failures      | REPLACE              | Add real local socket peers for missing endpoint, peer close without response and a silent peer. Only time is controlled in the deadline test; transport and socket behavior remain real. This does not claim malformed messages or every platform are covered.                                                                                                     |
| `tests/daemon/client.test.ts`: rendering         | REWRITE              | Preserve useful error/text/structured conversion in one boundary test. Replace image filename checks with actual saved-byte and declared-extension checks, cleaning every artifact.                                                                                                                                                                                 |
| `tests/e2e/ghostframe-start-stop.test.ts`        | REPLACE              | Retain real CLI stopped/running state, documented headless/isolated defaults, restart and repeated stop. Replace lazy daemon startup with an actual browser storage round trip across a profile restart, as promised in the CLI guide.                                                                                                                              |
| `tests/e2e/ghostframe-commands.test.ts`          | REWRITE              | Combine page listing and screenshot in one persistent browser flow; read the PNG signature and artifact bytes. Preserve disabled-category error and recovery instruction without declaring the current zero exit status a desired contract.                                                                                                                         |
| `tests/e2e/ghostframe-status.test.ts`            | DELETE               | Its only test started a daemon and checked running state, already exercised through the retained CLI lifecycle flow. It did not independently inspect status contents.                                                                                                                                                                                              |
| `tests/e2e/ghostframe-disclaimers.test.ts`       | DELETE               | Its sole assertion matched incidental startup prose on stderr. The CLI guide defines lifecycle, browser state and settings, not exact disclaimer wording; deleting this assertion leaves those contracts covered.                                                                                                                                                   |
| `tests/proxy.test.ts`                            | KEEP / REWRITE       | Retain meaningful parsing, unauthenticated SOCKS, legacy opt-in, environment credential and redaction policies. Rename a helper-only test so it does not claim actual logging coverage. Add partial/conflicting credential rejection. Real native routing and no-fallback behavior are covered separately in `tests/investigation/ProxyController.test.ts`.         |
| `tests/check-for-updates.test.ts`                | REWRITE / UNRESOLVED | Retain opt-out, newer-release notification and cache freshness regressions using real temporary files. Stub only the registry subprocess and home-directory isolation, plus the notification sink. The helper currently has no production callers and refers to upstream public updates despite this private fork; its product relevance remains unresolved.        |
| `tests/third_party_notices.test.ts` and snapshot | REPLACE / UNRESOLVED | Remove the full dependency-text snapshot. Validate dependency identities, license headings/text and generated package metadata when the actual bundle artifact exists; account for manually collected DevTools license entries. Ordinary build does not produce this artifact, so absence is an explicit skip. Bundle validation remains a separate packaging gate. |

## Named replacements

- `parses with default args`, `parses with user data dir`,
  `parses with executable path`, `parses viewport`, `parses chrome args`,
  `parses ignore chrome args`, and `parses disabled category` become three
  checks: `defaults to headed stable Chrome and conservative
file and credential access`, `selects an explicit profile and custom
executable without injecting a conflicting channel`, and `retains viewport
and repeated Chrome arguments while honoring disabled categories`.
  Launch schemas and README options establish the expected values.
- Serializer `should ignore undefined or null values`, `should handle boolean
values`, `should handle array values`, `should handle primitive values`, and
  `should convert camelCase keys to kebab-case` become `round-trips real
profile, proxy, executable, category and repeated Chrome options`.
  [CLI launch](../src/bin/ghostframe.ts) invokes
  [serializeArgs](../src/daemon/utils.ts), and
  [the parser examples](../src/bin/ghostframe-mcp-cli-options.ts) explicitly
  support repeated leading-dash Chrome arguments.
- Daemon `should start and stop daemon`, `should handle starting daemon when
already running`, and `should handle stopping daemon when not running`
  become `starts one daemon per session and makes repeated start/stop
idempotent`. `redacts legacy proxy credentials from daemon status` becomes
  `redacts legacy proxy credentials from actual daemon status`; unique secrets
  avoid confusing harmless words with credentials.
- `handles MCP response with text format`, `handles JSON response`,
  `handles error response when isError is true`, and `handles text response
when json format is requested but no structured content` become `keeps
error details and text fallback usable when structured output is
unavailable`. `supports images` and `uses the webp extension for WebP
images` become `writes image payload bytes to readable artifacts with their
declared file type`, additionally covering JPEG and binary byte integrity.
- IPC adds `rejects a missing peer instead of leaving the command pending`,
  `rejects when a connected socket closes without a reply`, and `enforces the
response deadline against a real silent socket peer`. These protect failure
  completion at the actual socket boundary, which previous happy-path daemon
  checks could not detect. The peer-close fixture reads the outgoing command
  before closing so it exercises absence of a response rather than merely
  racing the initial write.
- CLI `can start and stop the daemon` and duplicate `reports daemon status
correctly` become `reports stopped/running state and restarts the selected
daemon with documented defaults`. `can start the daemon with userDataDir`
  becomes `retains real browser storage across CLI restarts with an explicit
userDataDir`. Previously no browser was opened, so profile persistence was
  untested.
- CLI `can invoke list_pages` and `can take screenshot` become `invokes
browser tools through one persistent daemon and saves a valid PNG artifact`.
  The disabled-network case becomes `reports disabled network tools and
explains the launch setting needed to enable them`.
- Update tests for fresh/newer/older caches become `notifies only for newer
cached releases and avoids registry checks for fresh caches`; stale/missing
  cases become `refreshes missing or stale caches once without blocking the
caller`. The opt-out case becomes `honors update opt-out without creating
cache files or launching a registry check`. No invented `Stats` or child
  process shapes are used, and actual registry execution remains excluded.
- Proxy helper `redacts embedded credentials before runtime proxy arguments
are logged` becomes `redacts embedded credentials in runtime proxy argument
objects`; it never exercised a log sink. `rejects partial or conflicting
credentials instead of silently mixing sources` adds explicit checks for
  the credential-source rules already enforced by the public proxy parser.
- Notices `matches snapshot if exists` becomes `includes dependency identity,
licenses and available license text in the bundle artifact`. The previous test silently
  succeeded when no file existed; the replacement reports an explicit skip.
  [Rollup configuration](../rollup.config.mjs) independently defines package
  metadata, manual DevTools entries and license rejection during bundling.

## Findings and coverage limits

The serializer round trip exposed a concrete failure: initial parsing retains
`--disable-quic` and `--no-first-run`, but separate serialized option/value
pairs cause reparsing to produce an empty Chrome-argument array. The regression
test preserves the documented behavior rather than blessing those output pairs.
Integration corrected `serializeArgs` to attach values beginning with a dash to
their option, so Chrome flags remain values rather than becoming daemon options.
The real parser round trip now passes, including ignored default Chrome flags.
The real profile test also exposed loss of immediately written local storage
across a CLI stop/start; startup alone had hidden this browser shutdown boundary.
The integration adds awaited browser shutdown, owns process signal handling, and
handles stdin closure. Puppeteer's competing default signal handlers must be
disabled because they can kill Chrome while the graceful shutdown is still
flushing its profile. These are production lifecycle corrections for the documented
persistence contract, not accommodations for mocked process behavior.

IPC failure tests exercise actual local sockets and the 60-second response
deadline without waiting a minute. They do not establish malformed-response
handling, concurrent-command semantics, partial-message recovery or Windows
named-pipe behavior. Windows fixtures avoid filesystem operations on pipe names,
but this audit ran on macOS. Credential status tests cover observable daemon
output; parser helper tests alone do not prove every log sink is safe.

CLI tool errors currently can exit zero. There is no independently documented
exit-code policy for this path, so the error message and recovery instruction
remain checked while the desired exit-code behavior is unresolved. The legacy
update helper's cache tests cannot demonstrate an active user update flow because
there are no production callers. Decide whether to remove the dormant helper or
define a private-fork update policy before expanding its tests.

The notices check requires `npm run bundle` followed by the focused test. A
normal build intentionally skips it. Semantic notices checks do not prove every
transitive dependency is listed; the bundle license plugin's rejection rules and
artifact inspection remain necessary. The parallel audit used an ordinary build.
After the agents finished, root integration ran a clean bundle so final verification
could exercise the actual notices artifact and remove stale compiled test files.

## Validation

Focused checks use `npm run test` with this inventory's paths. Every run rebuilds
TypeScript and exercises the actual collaborators described above. The initial
checks found the serializer and profile failures documented above. Both regressions
passed after integration corrected the production boundaries. The profile check
observes the actual stored value before shutdown and after a fresh browser launch;
no wait was added to conceal lost data. The real daemon IPC, credential redaction,
CLI PNG artifact, parser settings and update-cache checks also passed.
The parallel notices run reported its packaging prerequisite as a skip.
Root integration then built the actual artifact and passed the notices check without a skip.
The initial per-package text assertion was corrected against Rollup's explicit nullable `licenseText` contract.
Package metadata remains required, as does the copied text in manual license entries.
See the main audit for final full-suite and formatting results.

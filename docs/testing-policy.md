# Testing policy

Apply this policy to all current and future work.
The objective is correct, maintainable software with the smallest sufficient set of meaningful checks.
Test count, coverage percentage, and a green suite are not separate goals.

## Establish intended behavior

Before changing code or tests, read the project instructions, requested deliverable, relevant documentation, public interfaces, and affected implementation.
Identify observable requirements, important failures, compatibility obligations, and unresolved assumptions.
Separate confirmed requirements from inference and incidental implementation details.

Use existing tests as evidence of intent.
Agreement between a test and the current implementation does not independently establish correctness.
Treat tests written under uncertain requirements as provisional.
Review them when understanding improves.

Ask for clarification only when a material requirement cannot be resolved from available evidence.
Continue independent work while that question is open.

## Audit the existing checks

Establish the relevant baseline before a change.
Distinguish existing failures from failures caused by the change.
Review tests by behavior or feature.

| Classification | Use when                                                                               |
| -------------- | -------------------------------------------------------------------------------------- |
| KEEP           | The check protects a confirmed requirement or meaningful regression.                   |
| REWRITE        | The behavior matters, but the assertions or mocks are brittle or incorrect.            |
| REPLACE        | Another test level checks the actual risk better.                                      |
| DELETE         | The check is obsolete, redundant, trivial, tautological, or coupled only to structure. |
| UNRESOLVED     | The intended behavior cannot yet be established.                                       |

Record a concise reason for each rewrite, replacement, and deletion.
If meaningful protection is removed, identify its replacement or explain why the behavior is no longer required.
Do not delete a check because it fails or covers an inconvenient case.

## Protect behavior instead of structure

Remove or rewrite checks that only exercise trivial accessors or forwarding code.
Do not preserve private methods, helper selection, or incidental call order without a behavioral reason.
Do not reproduce the production algorithm to calculate the expected answer.
Do not assert that a mock returns its configured value.

Avoid assertions about incidental formatting, logs, or error wording.
Delete redundant checks that provide no distinct protection or better diagnosis.
Remove checks for abandoned experiments and removed features.
Do not add tests solely to increase coverage.

An internal interaction can be a valid contract.
Examples include preventing duplicate effects or limiting expensive calls.
State that behavioral reason explicitly.

## Diagnose failures before changing expectations

1. Identify the behavior the failing check claims to protect.
2. Compare that expectation with confirmed requirements and compatibility obligations.
3. Determine whether the defect is in the implementation, test, or requirement interpretation.
4. Correct the defective part.

Do not distort correct code to satisfy an incorrect test.
Do not introduce special cases, test-only production paths, or unnatural interfaces for a flawed expectation.
Do not change expected values only to make the suite pass.
Use evidence independent of the new implementation to justify an expectation change.

A refactor should normally preserve behavior checks.
If many tests break, inspect their structural coupling before repairing them mechanically.
Update checks when behavior intentionally changes or disappears.

## Justify each new unit test

Before adding a unit test, answer these questions:

- Which confirmed behavior does it protect?
- Which plausible defect would make it fail?
- Why do existing checks not detect that defect adequately?
- Why is a unit test the appropriate level?
- Can the expected result be established independently of the implementation?

Do not add the test without concrete answers.
Prioritize nontrivial rules, calculations, parsing, validation, boundaries, state transitions, reused utilities, and isolated regressions.
For a bug fix, prefer a regression that fails before the fix and passes afterward.
Place it where the defect occurs.

## Choose the level that checks the risk

| Level       | Appropriate risk                                                             |
| ----------- | ---------------------------------------------------------------------------- |
| Unit        | Isolated logic with meaningful input and output.                             |
| Integration | Real collaborators, filesystem behavior, framework wiring, or serialization. |
| Contract    | A relevant protocol, service, or public API agreement.                       |
| End to end  | A small set of critical user journeys.                                       |
| Static      | Errors the compiler or linter can detect reliably.                           |
| Visual      | Appearance and layout.                                                       |

Do not substitute mocks for a real boundary and claim that the integration works.
Use real, inexpensive collaborators where practical.
Use test doubles for nondeterminism, expensive operations, or external effects.
Avoid mocks that reproduce the implementation.

Skip dedicated unit tests for low-risk cosmetic changes, trivial glue, and disposable experiments.
An identified regression or meaningful rule can justify an exception.

## Keep checks economical

Run focused checks during iteration.
Broaden checks when shared behavior, integration boundaries, or unresolved risk justify the cost.
Complete project-required checks before reporting completion.
Do not repeat an unchanged full suite without a concrete reason.

Avoid unnecessary dependencies, fixtures, snapshots, and CI jobs.
Do not introduce blanket coverage targets.
Do not weaken meaningful gates to reduce runtime.
Treat test maintenance, agent work, execution time, and CI use as costs to justify.
Fewer tests are not automatically better.
Each additional check must earn its cost.

## Verify and report the cleanup

Confirm that retained behaviors still have meaningful checks.
Confirm that rewritten checks tolerate relevant internal restructuring.
Check that assertions can detect the defects they claim to protect.
When useful, introduce one representative defect, verify failure, and revert it immediately.

Run the appropriate checks and inspect the results.
Leave unrelated work intact.
Report kept, rewritten, replaced, and deleted checks with grouped reasons.
Report production changes, their behavioral justification, check results, and remaining uncertainties or gaps.
Explain why the checks protect the deliverable; a green suite alone is insufficient.

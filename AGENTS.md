# ghostframe-mcp

A private stealth browser-automation MCP server and CLI, forked from
chrome-devtools-mcp. Stealth is always on; see `README.md` for what diverges
from upstream.

## Instructions

- Use only scripts from `package.json` to run commands.
- Use `npm run build` to run tsc and test build.
- Use `npm run test` to build and run tests, run all tests to verify correctness.
- Use `npm run test path-to-test.ts` to build and run a single test file, for example, `npm run test tests/McpContext.test.ts`.
- Use `npm run format` to fix formatting and get linting errors.

## Rules for TypeScript

- Do not use `any` type.
- Do not use `as` keyword for type casting.
- Do not use `!` operator for type assertion.
- Do not use `// @ts-ignore` comments.
- Do not use `// @ts-nocheck` comments.

## Exception: internal CDP access

Puppeteer does not expose a page's primary CDP session publicly, but input and
emulation overrides must be sent on that exact session. Reaching it through
`(page as any)._client()` with an `eslint-disable` is permitted. Existing
precedents: `src/McpContext.ts`, `src/McpResponse.ts`, `src/PageCollector.ts`,
`src/utils/humanInput.ts`.

- Do not use `// @ts-expect-error` comments.
- Prefer `for..of` instead of `forEach`.

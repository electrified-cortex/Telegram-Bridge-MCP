---
id: fix-brittle-string-assertions-tests
title: Replace JSON.stringify string-contains assertions with errorCode() in ~15 tool test files
type: refactor
delegation: Worker-claimable (Overseer dispatches)
stage: queued
created: 2026-05-24
target_repo: electrified-cortex/Telegram-Bridge-MCP
target_branch: dev
---

# refactor — Replace brittle string assertions with errorCode() helper

## Context

~15 tool test files assert on error codes by serializing the result to JSON and checking for string presence:

```typescript
// Brittle — breaks if response structure changes
expect(JSON.stringify(result)).toContain("AUTH_FAILED");
expect(JSON.stringify(result)).toContain("NAME_CONFLICT");
```

The codebase already has a proper `errorCode(result)` helper that extracts the error code field directly. Newer tests use it correctly. The older tests predate this helper.

Known primary offenders (from audit):
- `src/tools/session/rename.test.ts` (lines 90–310)
- `src/tools/message/edit.test.ts` (lines 162–186)
- `src/tools/message/delete.test.ts` (lines 69–94)

Plus an estimated 12 more tool test files using the same pattern.

## What to change

For each affected file, replace:

```typescript
expect(JSON.stringify(result)).toContain("SOME_ERROR_CODE");
```

with:

```typescript
expect(isError(result)).toBe(true);
expect(errorCode(result)).toBe("SOME_ERROR_CODE");
```

Import `isError` and `errorCode` from the shared test helpers if not already imported.

## Acceptance criteria

- AC1. No test file contains `JSON.stringify(result)` used to check error codes.
- AC2. All replaced assertions use `errorCode(result)` (or equivalent typed accessor).
- AC3. All tests pass after the change (`npm test` exits 0).
- AC4. No test logic is altered — only the assertion mechanism changes. Each test must assert the same error code it asserted before.

## Out of scope

- Any `JSON.stringify` usage unrelated to error code assertions (e.g., snapshot testing, logging).
- Changing which error codes are expected.
- Adding new test cases.

## Overseer review

- **Reviewer:** Overseer
- **Date:** 2026-05-24
- **Verdict:** APPROVED
- **Review type:** light-scan (operator-requested cleanup from test audit)

**Checked:**
- Scope clear — mechanical substitution, no behavioral change
- AC1 verifiable by grep
- AC4 ensures no accidental test weakening

**Not checked:**
- Full enumeration of all affected files (worker should grep for `JSON.stringify(result)` to find complete list)
- Whether `errorCode` helper is already imported in each file

## Verification

- **Verdict:** APPROVED
- **Verifier:** task-verification dispatch sub-agent (standard tier)
- **Date:** 2026-05-24
- **Commit:** e1d94d3 (squash of worker/fix-brittle-string-assertions-tests-2026-05-24 @ 54031bfb)
- **Test gate:** 142 files / 3203 tests pass (3221→3203 reflects prior cleanup task)
- **ACs confirmed:** AC1 (no JSON.stringify error-code assertions remain), AC2 (all use errorCode()), AC3 (tests pass), AC4 (no logic changed — mechanical substitution only)
- **Sealed-By:** Foreman

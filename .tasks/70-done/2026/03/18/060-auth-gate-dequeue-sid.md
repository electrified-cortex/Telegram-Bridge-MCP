# Auth-Gate dequeue_update SID Parameter

**Type:** Security / Hardening
**Priority:** 060 (High — multi-session isolation)
**Source:** Copilot PR review #3 (2026-03-18), comment on `src/tools/dequeue_update.ts` line 83

## Description

`dequeue_update` accepts an optional `sid` parameter to select which session queue to read from, but does not require a `pin` or any authentication. An agent could drain another session's queue by guessing/passing their SID.

## Copilot Comment

> `dequeue_update` allows selecting a session queue via `sid` without authenticating (no `pin` / `identity` check). In multi-session mode this lets one agent drain another agent's queue by guessing/passing their SID, causing cross-session data exposure and interference.

## Fix

Add authentication when an explicit `sid` is passed:
- Accept optional `pin` alongside `sid`
- When `sid` is provided, require `pin` and validate via `checkAuth`
- When `sid` is not provided (default), use ALS session context (no auth needed)

## Code Path

- `src/tools/dequeue_update.ts` — add `pin` to schema, auth check when `sid` is explicit
- `src/tools/dequeue_update.test.ts` — add tests for auth enforcement

## Acceptance Criteria

- [x] Explicit `sid` requires matching `pin`
- [x] Missing/wrong `pin` with explicit `sid` returns auth error
- [x] Default (no `sid`) behavior unchanged
- [x] Tests cover auth enforcement + rejection
- [ ] Reply to Copilot comment on GitHub PR (skipped per worker rules — no external comms)
- [x] Build passes, lint clean, all tests pass
- [ ] `changelog/unreleased.md` updated (skipped per worker rules)

## Completion

- Added optional `pin` parameter to `dequeue_update` schema in `src/tools/dequeue_update.ts`
- Imported `checkAuth` from `../session-auth.js`
- Added auth gate: when `explicitSid !== undefined`, returns `AUTH_REQUIRED` if `pin` is missing, or delegates to `checkAuth` for credential validation
- Auth gate runs BEFORE the `SID_REQUIRED` multi-session check
- Added `vi.mock("../session-auth.js")` with `checkAuth` mock to `src/tools/dequeue_update.test.ts`
- Added 5 new tests in `describe("auth gate")`: AUTH_REQUIRED on missing pin, AUTH_FAILED on bad pin, checkAuth called with correct args, success path, and no-pin-needed when sid omitted
- Updated 7 existing tests that used explicit `sid` without `pin` to add `pin: 1234`
- Updated all affected calls in `src/tools/multi-session-integration.test.ts` (9 locations) — integration tests use real `validateSession` so they pass the actual `pin` from `createSession()`
- 78 files, 1478 tests pass. Lint clean. Build clean.

---
Created: 2026-04-11
Status: Draft
Host: local
Priority: 10-485
Source: Operator directive + Deputy API audit
---

# 10-485: v6.0.3 — API Consistency & Quality Cleanup

## Objective

Comprehensive cleanup of API response consistency, brittle tests, exposed internals, and orphaned docs. Targets all issues from the Deputy's Phase 2 audit plus operator-reported concerns.

## Context

PR #135 (v6.0.2) fixed legacy tool name references and minor text. But deeper quality issues remain: inconsistent error shapes, exposed token formula, tests coupled to exact prose, and orphaned docs. Copilot review found issues on nearly every line — the API surface needs a thorough polish pass.

## Scope

### Critical

1. **Remove token formula from session_start description** — The DESCRIPTION string in `session_start.ts` says "The token encodes both sid and pin as a single integer (sid * 1_000_000 + pin)." Token is opaque. Remove this entirely. Agents don't need the formula.

2. **Fix dequeue error field inconsistency** — `dequeue.ts` L90-104 returns `{ error: "TIMEOUT_EXCEEDS_DEFAULT" }` and `{ error: "session_closed" }` instead of `{ code: "...", message: "..." }`. Every other tool uses `code`. Either:
   - Convert to `toError({ code: "TIMEOUT_EXCEEDS_DEFAULT", message: "..." })`, or
   - Document as intentional "soft errors" with clear rationale

### Major

3. **Fix approve error codes** — `approve_agent.ts` L41/51 returns `{ code: "UNKNOWN" }` with message prefixes like `NOT_PENDING:` and `INVALID_COLOR:`. Replace with proper specific codes: `{ code: "NOT_PENDING" }`, `{ code: "INVALID_COLOR" }`.

4. **Normalize session_start conditional fields** — `session_start.ts` L395-429: `discarded` only present if > 0, `fellow_sessions` only in multi-session. Always return these fields (empty array / 0) for predictable response shape.

### Minor

5. **3 remaining legacy tool name refs** — `identity-schema.ts` L9, `list_sessions.ts` L28, `load_profile.ts` L13 — still say "from session_start" instead of "from action(type: 'session/start')".

6. **Dequeue timeout-exceeded hint** — fires on every call, not just first occurrence. Should fire once then stop repeating.

7. **send.ts conditional `info` field** — only present on truncation/table warnings. Either always include (null when absent) or document as optional.

8. **close_session.ts variable response** — response shape varies by path (self vs governor, `reason` field). Normalize.

### Docs

9. **Delete `docs/release-announcement-v6-draft.md`** — orphaned artifact, unnecessary.

10. **Review design doc accuracy** — design doc may reference outdated tool names ("edit_message_text", "Texas voices"). Either update to match reality or delete if obsolete.

### Tests

11. **Refactor brittle content tests** — Tests that assert exact prose strings (e.g., `expect(content).not.toContain("save to session memory")`) should be refactored. Extract user-facing strings to constants. Tests verify structure and response codes, not exact wording.

## Acceptance Criteria

- All error responses use `{ code, message, hint? }` shape — no `error` field
- Token formula removed from all user-facing strings
- All approve error codes are specific (never `UNKNOWN` with message prefix)
- session_start always returns same field set
- Zero legacy tool name references remain
- Content tests use constants, not hardcoded strings
- Orphaned docs deleted
- All existing tests pass (2201+)

## Notes

- After this task, TMCP should be clean enough for v6.0.3 release
- Items 1-2 are the highest priority — start there
- This is a single branch, single PR task

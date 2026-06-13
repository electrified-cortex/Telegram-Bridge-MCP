# Enforce Identity on All Tool Calls

**Type:** Security / Architecture
**Priority:** 010 (Critical — auth model must be correct before release)
**Supersedes:** Task 060 (auth-gate dequeue_update — now part of this task)

## Design Intent (from operator)

> Source: operator voice (distilled). Nearly every tool must carry an identity. Once an identity is received from session_start, the session reuses it; the pin code is never passed around — the session uses it itself. SID may target a different session (e.g. DMs), but the caller's own identity is always present.
>
> Multi-session mode is always in effect — it is never "not multi-session mode." With a single session, the only difference is UI (name tags are not shown).

## Key Rule

**`identity` is ALWAYS required.** There is no "single-session bypass." The server is always in multi-session mode. The 1-session case only affects UI (name tags). `requireAuth()` must NEVER skip auth because there's only one session.

## Current State (3 patterns)

| Pattern | Tools | Auth | Problem |
| --- | --- | --- | --- |
| A (strict) | close_session, route_message, send_direct_message | Explicit sid+pin via `checkAuth` | ✅ Correct |
| B (flexible) | send_text, send_message, notify, show_animation, send_text_as_voice | Optional `identity: [sid, pin]`, required in multi-session | ⚠️ Close but "optional" is wrong |
| C (already have identity) | ask, confirm, choose + 30 more | `identity` tuple + `requireAuth()` — but optional bypass | ⚠️ Remove bypass |
| Hybrid | dequeue_update | Conditional auth (only when sid passed) | ❌ Must always auth |

## Desired State

**All tools accept `identity: [sid, pin]`** — ALWAYS required (not optional):

- `identity` is required on every tool call, period
- No "single-session" bypass — the server is always multi-session
- `requireAuth()` must always validate, never skip
- The only difference with 1 session vs 2+ is UI (name tags shown or not)
- Middleware ALS remains as internal plumbing but is NOT a substitute for explicit auth

## Changes Needed

### 1. Remove single-session bypass from `requireAuth()`:

- `src/session-gate.ts` — remove the `activeSessionCount() <= 1` bypass
- `requireAuth()` must ALWAYS validate identity, never skip
- If identity is omitted, return `SID_REQUIRED` error (no fallback to `getActiveSession()`)

### 2. Convert 5 tools from separate `sid`/`pin` to `identity` tuple:

- `src/tools/close_session.ts` — replace `SESSION_AUTH_SCHEMA` (separate sid/pin) with `identity` tuple + `requireAuth()`
- `src/tools/route_message.ts` — same
- `src/tools/send_direct_message.ts` — same (note: also has `target_sid` for the recipient — keep that separate)
- `src/tools/rename_session.ts` — same
- `src/tools/dequeue_update.ts` — replace separate optional `sid`/`pin` with required `identity` tuple + `requireAuth()`

### 3. No-auth tools (leave as-is):

- `session_start` — creates credentials, no auth possible before session exists
- `get_me` — bot info, public
- `get_agent_guide` — docs, public
- `list_sessions` — discovery, public
- `shutdown` — system level

### 4. 35 tools already have `identity` tuple — just remove "optional" semantics:

- These already call `requireAuth(identity)` — the bypass removal in step 1 makes them enforce auth automatically
- No changes needed in the tool files themselves

### Tests:

- Update test files for ask, confirm, choose, dequeue_update
- Add tests: missing identity in multi-session → error
- Add tests: valid identity → success

### Docs:

- Update `docs/multi-session.md` — all tools require identity in multi-session mode
- Update `docs/design.md` — auth model section

## Acceptance Criteria

- [x] All tools accept `identity: [sid, pin]` as a required parameter
- [x] `requireAuth()` always validates — no single-session bypass
- [x] Tool calls without valid identity return `AUTH_FAILED` or `SID_REQUIRED`
- [x] No tool relies solely on ALS for auth — `requireAuth()` is the gate
- [x] dequeue_update uses `identity` tuple like everything else
- [x] Tests cover auth enforcement for all modified tools
- [ ] Reply to Copilot comment on GitHub PR (dequeue_update auth)
- [x] Build passes, lint clean, all tests pass (77 files / 1419 tests)
- [x] `changelog/unreleased.md` updated

## Completion Note

Completed 2026-03-18. All acceptance criteria met except the GitHub PR comment (no open PR exists).
Summary of changes:
- `session-gate.ts`: removed single-session bypass from `requireAuth()`
- `dequeue_update.ts`: migrated to `identity: [sid, pin]`, removed legacy `checkAuth`
- Pattern A tools (`close_session`, `route_message`, `rename_session`, `send_direct_message`): migrated from `{ sid, pin }` to `{ identity: [sid, pin] }`
- All 35 Pattern B tools: `identity` schema kept `.optional()` so Zod passes through `undefined` to `requireAuth()` for structured error reporting
- 77 test files updated throughout the session to pass `identity: [sid, pin]` consistently

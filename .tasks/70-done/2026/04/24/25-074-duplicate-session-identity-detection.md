# Task: Duplicate Session Identity Detection

**Created:** 2026-04-01
**Status:** draft
**GitHub Issue:** #102

## Objective

Prevent two agent instances from operating as the same session. Add server-level
defense-in-depth against SID/PIN credential sharing.

## Context

Observed incident: two Claude Code Worker instances shared the same SID/PIN through
shared session memory. Both polled `dequeue_update` simultaneously, splitting the event
stream. One consumed ~26,000 tokens in a runaway loop. Client-side fix is deployed
(workers no longer persist credentials), but bridge-level protection is needed.

## Approach (from GitHub issue)

**Option A — HTTP Session Fingerprint:**
Assign a unique connection UUID per client on first `session_start`. Track alongside
`[SID, PIN]`. If a second client with a different fingerprint uses the same credentials,
reject with `409 Conflict` or alert the governor.

**Option B — Dead Session Response:**
When `dequeue_update` is called on a closed/invalid session, return a clear
`session_closed` error instead of empty results that cause infinite retry loops.

Both options recommended for defense-in-depth.

## Acceptance Criteria

1. Second client using same `[SID, PIN]` is rejected or alerts governor.
2. `dequeue_update` on a closed session returns explicit error.
3. No breaking changes to existing single-client flows.

## Design Discussion Needed

Operator wants to discuss implementation approach before queuing. Specifically:
- Whether fingerprinting should be per-HTTP-connection or per-`session_start` call.
- Error response format for dead sessions.
- Whether to alert governor vs reject outright.

## Notes

- See GitHub issue #102 for full spec.
- Security-tagged issue.
- Requires bridge-level implementation (session manager, dequeue handler).

## Completion

Branch: `25-074`
Commit: `32d9ee4`
Worker: Worker 6 (SID 8)

### Deliverables
- `src/session-manager.ts` — `connectionToken` (UUID) field added to `Session`; `createSession` generates and returns it; `checkConnectionToken` + `getConnectionToken` helpers added
- `src/tools/session_start.ts` — `connection_token` returned in response; `forceColor` fallback corrected to `?? false`
- `src/tools/dequeue.ts` — Option A detection: mismatch alerts governor or falls back to `dlog`; truthy guard; design questions documented
- `src/service-messages.ts` — `DUPLICATE_SESSION_DETECTED` entry added
- `src/tools/dequeue.test.ts` — 10 new tests (Option A + Option B behaviors)
- `src/tools/session_start.test.ts` — 2 new tests; existing snapshots updated to include `connection_token`

### Design choices
- Advisory (alert) not reject — allows legitimate session to continue while flagging duplicate
- `connection_token` absent on dequeue → silently skipped (backward-compatible)
- Dead session error was pre-existing; tests added to lock behavior

### Follow-up filed
`tasks/10-drafts/20-draft-session-joined-fellow-service-message.md` — pre-existing SERVICE_MESSAGES inconsistency surfaced during review

### Verification
- Build: PASS; Lint: PASS; Tests: 2613/2613 pass
- 3-pass code review: all majors resolved; remaining minors/nits accepted per Overseer

---
Created: 2026-04-06
Status: Queued
Host: local
Priority: 20-345
Source: Operator (voice feedback during fleet management session)
---

## Re-queued (2026-04-08)

Task was in `3-in-progress/` but stalled. Worktree `.worktrees/20-345` exists and is clean. Branch `20-345` has commits including a dev merge (`e17d4b3`). Worker must resume from existing worktree.

> **⚠️ RE-QUEUED (2026-04-07):** This task was previously marked complete but
> the branch was never merged to main. An existing worktree with uncommitted
> work may exist. The Worker must:
> 1. Check for an existing worktree branch matching this task ID
> 2. If found, review the existing work before starting fresh
> 3. Merge or rebase as appropriate — do not duplicate effort
> 4. Ensure all files are committed before marking complete

# Session Management Commands and Governor Close

## Objective

Add operator and governor ability to manage individual sessions — close them,
set governor, and list/interact with active sessions via Telegram commands.

## Background

Currently:

- `close_session` only closes the caller's own session (no target parameter).
- The governor cannot close orphaned or misbehaving sessions.
- The operator has no `/session` command to manage individual sessions.
- Governor assignment can only happen via the lowest-SID heuristic on join, or
  `/primary` command.

The operator wants a unified `/session` command that lists active sessions and
provides per-session actions.

## Requirements

### 1. Governor Close Session (MCP Tool)

Extend `close_session` with an optional `target_sid` parameter:

- **Self-close (existing):** `close_session(token)` — closes caller's own
  session. Requires caller's own token.
- **Governor-close (new):** `close_session(token, target_sid)` — closes the
  target session. The system checks: does this token belong to the governor? If
  yes, close target. If no, reject with clear error.

Only the governor can close other sessions. Non-governors (e.g., Worker 1)
cannot close Worker 2.

### 2. `/session` Telegram Command (Operator)

Replace the current `/session` command with a drill-down UI for fleet
management. The operator envisions a unified session management interface:

- `/session` → Lists all active sessions (SID, name, color, uptime)
- **Drill-down:** Tapping a session shows detail view with inline actions:
  - **Close** — end that session (with confirmation: "Are you sure? Yes/No")
  - **Set as Primary** — transfer governor role to this session
  - (Future: mute, DM, etc.)
- Bundle the current `/primary` concept into this — no separate `/primary`
  command needed. Governor assignment is just an action within `/session`.
- The UI should support navigating back to the session list from the detail view.

### 3. Rename Old `/session` → `/log`

Any session-recording functionality currently under `/session` moves to `/log`.
The `/session` namespace is fully reclaimed for fleet management.

## Acceptance Criteria

- [x] Governor can close another session via MCP tool call (governor status is
      sufficient — no target token needed)
- [x] Closing another session requires confirmation ("Are you sure?" Yes/No)
- [x] Non-governor attempting to close another session gets clear error
- [x] `/session` command lists active sessions with inline action buttons
      (operator-only — agents cannot use)
- [x] Tapping a session shows drill-down detail with Close and Set as Primary
- [x] "Close" action ends that session cleanly with confirmation step
- [x] "Set as Primary" transfers governor role
- [x] Back-navigation from detail returns to session list
- [x] Governor closes itself → auto-promote next active session to governor (via existing close_session logic)
- [x] Zero active sessions → displays "No active sessions"
- [x] Session closes while operator viewing detail → UI updates gracefully
- [x] Session closed events fire with `target_sid` and `governor_sid` (via existing close_session teardown)
- [x] Old `/session` recording renamed to `/log`
- [x] Tests for governor close authorization and auto-promotion

## Run Log

1. Task Runner (pass 1) — built session-teardown.ts, extended close_session.ts, added /session and /log to built-in-commands.ts. 2078/2079 tests.
2. Build Verifier (pass 1) — tsc clean, 1 pre-existing failure. Passed.
3. Code Reviewer (pass 1) — **3 Major**: no /session tests, no /log tests, TOCTOU race in governor-close. **3 Minor**: auth discrepancy (operator bypasses governor check in UI — intentional, noted), ignored closeSessionById result, minor sequencing. **2 Info**.
4. Task Runner (pass 2) — fixed TOCTOU (re-check after approval await), added /session tests (11 cases), added /log tests (3 cases), fixed ignored close result. 2092/2093 tests.
5. Build Verifier (pass 2) — tsc clean. Pass.
6. Code Reviewer (pass 2) — **Minor**: GOVERNOR_CHANGED path not tested (implementation exists, test missing). **Info**: dead guard conditions on session:close: branch. All pass-1 findings verified fixed.
7. Committed on branch `20-345` in `Telegram MCP/.worktrees/20-345` as `05acfa9`.

## Completion

**What changed:**
- `src/session-teardown.ts` (new): shared `closeSessionById(sid)` helper extracted to avoid circular imports between close_session.ts and built-in-commands.ts.
- `src/tools/close_session.ts`: refactored to use `closeSessionById`; added optional `target_sid` for governor-close with permission check, TOCTOU re-check after operator confirmation, and session-not-found guard.
- `src/built-in-commands.ts`: added `/session` fleet management command (session list → drill-down → close with confirmation → set primary → back); added `/log` recording panel; removed `/primary` from Telegram command menu (functionality bundled into `/session`).
- `src/tools/close_session.test.ts`: 6 new governor-close tests.
- `src/built-in-commands.test.ts`: 14 new tests for /session and /log commands.
- `src/tools/set_commands.test.ts`: updated to reflect /primary removal from menu.

**Branch:** `20-345` in `Telegram MCP` repo
**Commit:** `05acfa9`

**Deferred / Minor findings:**
- `GOVERNOR_CHANGED` test path: implementation present, test not added in pass 2 (Minor finding from reviewer).
- Dead guard conditions in `session:close:` branch callback routing (Info — harmless).
- Operator/governor auth discrepancy in `/session` UI close vs MCP tool close: intentional — operator outranks governor. Not a defect.

## Resolved Questions

- **Governor close authorization:** Governor status alone is sufficient — no
  target token needed. Governor token proves identity.
- **`/session` availability:** Operator-only for actions. Agents cannot use
  `/session`.
- **`/log` rename:** Included in this task scope.

## Notes

- Operator noted: denial of a session IS a negative signal. When operator
  explicitly denies via button, delegation auto-disable may be intentional
  (handled separately in 20-344).
- The current MCP build may be behind — some behaviors may already be addressed
  in newer code. Verify against current dev branch before implementing.

# 10-0894 — "stopped" HTTP event for instant activity-file kick flush

**Priority**: 10 (high — improves response latency for stop-and-resume agent pattern)
**Status**: queued (ready for Worker via foreman)
**Type**: feature
**Target release**: 7.4.3
**Target branch**: release/7.4.3
**Tags**: feature-add, enhancement
**Created**: 2026-05-10 (operator MSG 52339)

## Context

Operator stated 2026-05-10:

> "When you 'stop', an event in TMCP can be poked for that session just
> like we do with compaction. That could cause an immediate flush of the
> activity file to get an instant response from you."

Current state: when an agent stops (drop-exit-resume pattern: foreman
or worker session ends via TaskStop or process exit), the next inbound
message for that session triggers the debounce timer (default 60s).
That 60s of latency before the next session is woken is pure overhead
when the agent has explicitly signaled "I'm gone."

The `compacting` HTTP event already exists at `POST /event` with the
strict kind allow-list (per v7.2.0 changelog). Add `stopped` to that
allow-list with a special handler.

## Acceptance criteria

### AC1 — Add `stopped` to the POST /event kind allow-list

`POST /event` currently accepts: `compacting`, `compacted`, `startup`,
`shutdown_warn`, `shutdown_complete`. Add `stopped` as a new accepted kind.

Like `compacting`, `stopped` may be POSTed by any participant for its own
session (token-authenticated).

### AC2 — On `stopped` for a session: cancel debounce + immediate kick

When `POST /event` with `kind: "stopped"` is received for a session
that has an active activity file registration:

1. Cancel any pending debounce timer for that session
   (`entry.debounceTimer`)
2. Mark `entry.nudgeArmed = true` (so kicks can fire again on next inbound)
3. Immediately call `doTouch(sid)` to flush a kick to the activity file
   — even if there is no currently-queued inbound. This signals the
   external watcher that the session is "available again."

The intent: the next inbound message (which arrives moments later when
the resumed agent re-enters its loop) will be picked up instantly
because the watcher's file Monitor will already have fired.

### AC3 — No wiring of the event source (deferred)

This ticket adds the SERVER-SIDE handling only. Wiring the agent to
actually POST `stopped` on stop is a follow-up (similar to how
`compacting` is fired by a hook, not by the agent inline).

Document the wiring point as a TODO in the handler:
> "Agent-side wiring: TBD — likely a Stop hook analogous to PreCompact."

### AC4 — Test coverage

- POST /event with `kind: stopped`, valid token → 200, kick fires within
  100ms (verify via activity file mtime check).
- POST /event with `kind: stopped`, no active activity file registration
  → 200 with `hint: "no-op"`.
- POST /event with `kind: stopped`, invalid token → 401.
- POST /event with `kind: stopped` on an unknown session → 404 or similar
  per existing convention.

### AC5 — Documentation

Update `help(topic: 'events')` to document the new kind. Note that
unlike `compacting`/`compacted`, `stopped` has a state-mutating side
effect (kick flush + debounce cancel) on the firing session itself.

## Non-goals

- Agent-side hook to fire `stopped` automatically on TaskStop.
- Bundling with the active kick-bug fix (10-0895) — that ships in
  parallel; this ticket assumes the kick mechanism works for non-stopped
  sessions.

## Notes

- Use the `compacting` handler in `src/event-endpoint.ts` (or wherever
  POST /event lives) as the structural template.
- The kick flush should set `entry.lastTouchAt = Date.now()` so the
  state stays consistent.
- This is the foreman's first ticket post-architecture-shipping. Operator
  expects it to use a worktree (mutation chain), bug-fix-small-style.

## Cross-references

- Sibling: 10-0895 (kick still broken post-7.4.2 — the urgent fix)
- v7.2.0 changelog: existing POST /event implementation
- `src/event-endpoint.ts` (or equivalent)
- `src/tools/activity/file-state.ts` — `doTouch`, `touchActivityFile`

## Verification

**Verdict:** APPROVED
**Date:** 2026-05-10
**Criteria:** 5/5 passed
**Evidence:** Commit d92c4d93 adds `stopped` to VALID_KINDS, implements `handleSessionStopped` (cancel timer + nudgeArmed=true + doTouch + lastTouchAt via doTouch), places TODO wiring comment in both handler and file-state.ts, adds 4 test cases covering active-file kick, no-op, invalid token, and unknown-session-via-401, and updates docs/help/events.md with stopped row and detailed state-effect section.

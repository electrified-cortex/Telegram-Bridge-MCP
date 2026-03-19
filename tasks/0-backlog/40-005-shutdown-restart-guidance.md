# 610 — Shutdown Restart Guidance for Worker Agents

**Priority:** 600 (Medium)  
**Source:** Operator request (voice, 2026-03-22) + restart-protocol.md

## Goal

Improve the shutdown experience so that worker agents receiving the shutdown signal know exactly what to do next — especially the fact that their session will be invalidated and they must start a fresh one after the server restarts.

## Background

`elegantShutdown()` already delivers a service message to every active session. However, the current message (`"⛔ Server shutting down…"`) gives no instruction to worker agents. Agents receiving it don't know:
- That their SID will be dead after restart.
- That they should not retry `dequeue_update` on the same session.
- How long to wait before re-establishing.

See `docs/restart-protocol.md` for the full procedure this task supports.

## Tasks

### 1. Update the shutdown service message (code change)

In `src/shutdown.ts`, change the per-session `deliverServiceMessage` call to include restart guidance:

**Current:**
```
"⛔ Server shutting down…"
```

**Proposed:**
```
"⛔ Server shutting down. Your session will be invalidated on restart. Do not retry dequeue_update on this session. Wait ~60 s, then call session_start to establish a new session."
```

Consider a multi-line or structured format if the service message formatter supports it.

### 2. Add a `notify_restart` / Phase-1 pre-warning mechanism (optional, evaluate)

The Governor should be able to send a pre-shutdown notification to worker sessions **without triggering actual shutdown**. Options:

**Option A — New MCP tool `notify_shutdown_warning`:**
- Parameters: `reason?: string`, `wait_seconds?: number`
- Sends a DM to all sessions (except the caller's) with the restart guidance message.
- Does not call `elegantShutdown()`.
- Returns `{ notified: N }` (count of sessions notified).

**Option B — Extend `elegant_shutdown` with a `pre_warn_only: true` mode:**
- Would run Phase 1 only (notify sessions, wait), not Phase 2 (poller stop, exit).
- Less clean separation of concerns — prefer Option A.

**Recommendation:** Option A keeps concerns clean and lets the Governor call pre-warning independent of the shutdown decision.

### 3. Update `behavior.md` shutdown section

Add a note in `docs/behavior.md` (agent guide) about what to do when a `shutdown` service event arrives:
- Stop loop.
- Do not retry on same session.
- Re-engage via `session_start` after operator restart.

## Acceptance Criteria

- [ ] `elegantShutdown()` service message includes restart guidance text.
- [ ] Worker agents can act on the service message without additional operator instructions.
- [ ] `notify_shutdown_warning` tool (or equivalent) exists for Phase 1 pre-warning.
- [ ] `behavior.md` documents the shutdown service event handler pattern.
- [ ] Tests updated for new message text and new tool.

## Related

- Task 600 (completed): `elegantShutdown()` base implementation
- `docs/restart-protocol.md`: procedure document this task supports
- `src/shutdown.ts`: where message text lives
- `src/built-in-commands.ts`: `/shutdown` handler

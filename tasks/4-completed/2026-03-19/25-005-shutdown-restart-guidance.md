# Task #005 — Shutdown Restart Guidance

| Field    | Value                                                |
| -------- | ---------------------------------------------------- |
| Priority | 25 (medium-high — important for multi-session ops)   |
| Status   | Draft                                                |
| Created  | 2026-03-19 (refined from backlog)                    |

## Goal

Improve the shutdown experience so worker agents receiving the shutdown signal know exactly what to do — and add a pre-warning mechanism for the governor.

## Strategy

**Branch from:** `v4-multi-session` (current HEAD)
**Worktree:** `25-005-shutdown-restart-guidance`
**Branch name:** `task/005-shutdown-restart-guidance`
**Separate PR:** Yes — targets `v4-multi-session`

This is a small code change + docs update. Worker should:

1. Update shutdown service message text in `src/shutdown.ts`
2. Add `notify_shutdown_warning` MCP tool (Option A from original spec)
3. Update `docs/behavior.md` shutdown section
4. Update changelog
5. Tests for new message text and new tool

## Scope

### 1. Update shutdown service message (code)

In `src/shutdown.ts`, change the per-session `deliverServiceMessage` text from:

```text
⛔ Server shutting down…
```

To:

```text
⛔ Server shutting down. Your session will be invalidated on restart. Do not retry dequeue_update. Wait ~60s, then call session_start to establish a new session.
```

### 2. Add `notify_shutdown_warning` tool (code)

New MCP tool that sends a pre-shutdown DM to all sessions except the caller:

- **Parameters:** `identity` (required), `reason?: string`, `wait_seconds?: number`
- **Behavior:** Sends a DM to each other active session with restart guidance
- **Returns:** `{ notified: N }` (count of sessions notified)
- **Does NOT** call `elegantShutdown()` — this is advisory only
- Register in `src/tools/` alongside other tools

### 3. Update `docs/behavior.md` (docs)

Add a section on shutdown service event handling:

- Stop dequeue loop
- Do not retry on same session
- Re-engage via `session_start` after operator restart

### 4. Changelog

Add entry to `changelog/unreleased.md` under Added and Changed.

## Acceptance Criteria

- [ ] Shutdown service message includes restart guidance
- [ ] `notify_shutdown_warning` tool exists and works
- [ ] `behavior.md` documents shutdown event handling
- [ ] Tests updated for new message text and new tool
- [ ] Build + lint + typecheck clean

## Key Files

- `src/shutdown.ts` — shutdown service message
- `src/tools/` — new tool registration
- `docs/behavior.md` — agent guide
- `docs/restart-protocol.md` — reference (no changes needed)
- `changelog/unreleased.md`

# Multi-Session Restart Protocol

> **Who this is for:** The Governor (Overseer) agent and any worker agents. This document describes the **procedure** for shutting down and restarting the multi-session environment safely.

---

## Roles

| Role | Responsibility |
|---|---|
| **Governor** | Coordinates shutdown. Sends pre-warnings. Commits, stages. Writes tasks. Does NOT implement code. |
| **Worker** | Implements tasks. Responds to pre-warning. Waits for restart. Re-engages after restart. |
| **Operator** | Initiates restart, waits, and re-engages agents after the server comes back up. |

---

## Why Sessions Are Invalidated on Restart

Each session (SID) is held in memory by the running server process. When that process exits and restarts, all session state is wiped — pending queues, session IDs, registered commands. A worker that tries to call `dequeue_update` after a restart will receive an error (or hang) because its SID no longer exists.

**Workers must start a fresh session after every restart.** The old SID is dead.

---

## Two-Phase Shutdown Procedure

### Phase 1 — Governor Pre-Warning (before `/shutdown`)

Before issuing the actual shutdown, the Governor notifies all active worker sessions directly:

1. Identify all active worker sessions (via `list_sessions` or known SIDs from session startup).
2. Send each worker a DM via their session:

   > "Heads up — we're shutting down shortly. Your session will be invalidated when the server restarts. **Do not start new work.** Finish your current tool call if safe, then wait. After the server comes back up (~60 seconds), your operator will re-engage you and you'll need to start a new session."

3. Allow a brief window (~15–30 s) for workers to reach a safe stopping point. Confirm with the operator if needed.

### Phase 2 — Actual Shutdown

4. Governor issues `/shutdown` (built-in command) or calls the `shutdown` MCP tool.
5. `elegantShutdown()` runs automatically:
   - Stops the Telegram poller (10 s cap).
   - Drains any remaining pending updates.
   - Delivers a **system-level service message** to every active session — this wakes blocked `dequeue_update` calls.
   - Waits 2 s for MCP stdio to flush.
   - Sends a final operator notification and calls `process.exit(0)`.

---

## What Workers Should Do

### On receiving the Governor's pre-warning (Phase 1)

- Acknowledge: react with 👍 or send a brief text reply.
- Do not start new tasks or long-running tool calls.
- Finish any in-progress tool call if it can be completed quickly.
- Enter a holding state — call `dequeue_update` with a short timeout (e.g. 60 s) and loop, watching for the system message.

### On receiving the shutdown service message (Phase 2)

When `dequeue_update` returns an event with `type: "service"` and `subtype: "shutdown"`:

1. **Stop immediately** — do not call `dequeue_update` again on this session.
2. Do not attempt to resume the dequeue loop. The session is about to be invalidated.
3. Respond to the MCP caller with a clean summary of current state (so the operator knows where you stopped).
4. Your MCP connection will close when the server exits. This is expected.

### After the server restarts

When the operator re-engages you (typically by sending a new message or pasting a re-engagement prompt):

1. Call `session_start` to register a new session — your old SID is invalid.
2. Resume from the last known task state (check your task file for context).
3. Re-enter the `dequeue_update` loop as normal.

> **Do not hardcode or remember old SIDs.** Always obtain a fresh SID from `session_start` after a restart.

---

## Fault Tolerance

### If the pre-warning is not sent (emergency shutdown)

If the operator issues `/shutdown` without a Phase 1 warning:
- Workers will still receive the system service message from `elegantShutdown()`.
- Workers should treat any `shutdown` service message as an immediate stop signal.
- Session recovery follows the same "start fresh" procedure above.

### If a worker's `dequeue_update` times out after restart

If a worker calls `dequeue_update` and receives repeated timeouts (or connection errors) after a restart:
- Assume the server restarted without notification.
- Wait 60 s, then call `session_start` to establish a fresh session.
- Notify the operator that a reconnect occurred.

---

## Operator Checklist

When restarting the server:

- [ ] Tell the Governor to issue Phase 1 pre-warnings to all workers.
- [ ] Wait for worker acknowledgments (or a reasonable timeout).
- [ ] Tell the Governor to issue Phase 2 shutdown (`/shutdown` or `shutdown` tool).
- [ ] Wait for the server to exit (watch for final operator notification).
- [ ] Restart the server process (Docker, systemd, or manual).
- [ ] Re-engage agents by sending a new message to each one.
- [ ] Confirm each agent has started a fresh session and resumed their task.

---

## Future Enhancements

See **task 610** for planned improvements:
- Update the `elegantShutdown()` service message to include explicit restart guidance for worker agents.
- Add a `notify_shutdown` tool or built-in command that the Governor can use for Phase 1 pre-warnings without triggering full shutdown.

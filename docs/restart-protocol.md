# Multi-Session Restart Protocol

> **Who this is for:** The Overseer agent and any worker agents. This document describes the **procedure** for shutting down and restarting the multi-session environment safely.

---

## Roles

| Role | Responsibility |
| --- | --- |
| **Overseer** | Coordinates shutdown. Sends pre-warnings. Commits, stages. Writes tasks. Does NOT implement code. |
| **Worker** | Implements tasks. Responds to pre-warning. Waits for restart. Re-engages after restart. |
| **Operator** | Initiates restart, waits, and re-engages agents after the server comes back up. |

---

## Why Sessions Are Invalidated on Restart

Each session (SID) is held in memory by the running server process. When that process exits and restarts, all session state is wiped — pending queues, session IDs, registered commands. A worker that tries to call `dequeue_update` after a restart will receive an error (or hang) because its SID no longer exists.

**Workers must start a fresh session after every restart.** The old SID is dead.

---

## Two-Phase Shutdown Procedure

### Phase 1 — Overseer Pre-Warning (before `/shutdown`)

Before issuing the actual shutdown, the Overseer notifies all active worker sessions directly:

1. Identify all active worker sessions (via `list_sessions` or known SIDs from session startup).
2. Send each worker a DM via their session:

   > "Heads up — we're shutting down shortly. Your session will be invalidated when the server restarts. **Do not start new work.** Finish your current tool call if safe, then end your agent turn and wait. After the server comes back up (~60 seconds), the operator will re-engage you and you'll need to start a new session via `session_start`."

3. Wait for each worker to acknowledge and confirm they have ended their turn (operator can visually confirm agents have stopped making tool calls).
4. Confirm with the operator before proceeding to Phase 2.

### Phase 2 — Actual Shutdown

1. Overseer issues `/shutdown` (built-in command) or calls the `shutdown` MCP tool.
2. `elegantShutdown()` runs automatically:
   - Stops the Telegram poller (10 s cap).
   - Drains any remaining pending updates.
   - Delivers a **system-level service message** to every active session — this wakes blocked `dequeue_update` calls.
   - Waits 2 s for MCP stdio to flush.
   - Sends a final operator notification and calls `process.exit(0)`.

---

## How to Sleep (Concrete Mechanism)

For an AI agent in VS Code Copilot, **"sleeping" means ending your agent turn**. You cannot pause mid-turn — the only real sleep state is yielding control back to the operator by making no further tool calls.

The concrete steps:

1. Send a final status message to the operator (or a DM to the overseer) summarising where you stopped.
2. Run a visible terminal command so the operator can see you have parked:

   ```powershell
   Write-Host "Session ended — awaiting operator restart and re-engagement."
   ```

3. **Stop making tool calls.** End your response. Do not call `dequeue_update` or any other MCP tool.
4. Wait for the operator to re-engage you (new message, new conversation, or a re-engagement prompt).

> This is the protocol equivalent of putting a sign on your desk that says "gone for restart — back shortly". The operator knows where you stopped, and they control when you resume.

---

## What Workers Should Do

### On receiving the Overseer's pre-warning (Phase 1)

1. Acknowledge via DM or 👍 reaction — one brief message is enough.
2. Do not start new tasks or long-running tool calls.
3. Finish the current tool call only if it will complete in seconds.
4. Run the "going to sleep" terminal command:

   ```powershell
   Write-Host "Session ended — awaiting operator restart and re-engagement."
   ```

5. **End your agent turn.** Do not call `dequeue_update` again. You are now parked.

### On receiving the shutdown service message (Phase 2)

If you are still in the `dequeue_update` loop when shutdown fires, you will receive an event with `type: "service"` and `subtype: "shutdown"`:

1. Do not call `dequeue_update` again on this session.
2. Send a brief final status message (if your MCP channel is still open).
3. Run the "going to sleep" terminal command.
4. **End your agent turn.** The MCP connection will close when the server exits — this is expected.

### What the Overseer must do after issuing shutdown

The Overseer is **also subject to this protocol.** After calling the `shutdown` MCP tool:

1. Send one final operator message confirming shutdown was issued.
2. Run the "going to sleep" terminal command.
3. **End your agent turn immediately.** Do not make any further tool calls — not even `dequeue_update`.
4. Wait for the operator to re-engage you after the server restarts.

### After the server restarts

When the operator re-engages you (new message or re-engagement prompt):

1. Call `session_start` to register a new session. Your old SID is dead — do not reuse it.
2. The new `session_start` response gives you a fresh `sid` and `pin`. Use these for all subsequent tool calls.
3. Resume from the last known task state (check your task file or the terminal output left by the "going to sleep" command).
4. Re-enter the `dequeue_update` loop as normal.

> **Do not hardcode or remember old SIDs.** Always obtain a fresh SID from `session_start` after a restart.
>
> **Overseer restarts first.** The Overseer must establish its new session before signalling workers to reconnect, so it is ready to coordinate again.

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

- [ ] Tell the Overseer to issue Phase 1 pre-warnings to all workers.
- [ ] Wait for worker acknowledgments (or a reasonable timeout).
- [ ] Tell the Overseer to issue Phase 2 shutdown (`/shutdown` or `shutdown` tool).
- [ ] Wait for the server to exit (watch for final operator notification).
- [ ] Restart the server process (Docker, systemd, or manual).
- [ ] Re-engage agents by sending a new message to each one.
- [ ] Confirm each agent has started a fresh session and resumed their task.

---

## Future Enhancements

See **task 610** for planned improvements:

- Update the `elegantShutdown()` service message to include explicit restart guidance for worker agents.
- Add a `notify_shutdown` tool or built-in command that the Overseer can use for Phase 1 pre-warnings without triggering full shutdown.

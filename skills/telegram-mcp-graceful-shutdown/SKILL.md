---
name: telegram-mcp-graceful-shutdown
description: >-
  Graceful shutdown procedure for Telegram bridge MCP agents. Use when an agent
  receives a shutdown signal and needs to cleanly exit its session.
compatibility: "Requires Telegram MCP bridge"
---

# Telegram MCP Graceful Shutdown

Clean exit for Telegram-enabled agents. Steps vary by role — the governor session has additional responsibilities.

## Common Shutdown (All Agents)

Triggered by: operator stop or `action(type: "shutdown/warn")` DM from governor.

1. **Drain queue.** `dequeue(max_wait: 0)` loop until `pending` = 0 and response = `empty`. ALWAYS drain before closing — unread messages lost when session ends.

2. **Finish current step.** Don't drop mid-operation.

3. **DM superior** with brief status:
   - Subordinate → supervising agent: *"Subordinate $Id shutting down."*
   - Supervising agent → governor: *"Supervising agent shutting down — pipeline status: [summary]."*
   - Specialist → governor: *"Specialist agent shutting down."*

4. **Wipe session memory file.** Overwrite with empty content via memory tool. Clears token so next launch sees empty file → clean start. Don't skip — stale session file causes next launch to offer resume on dead session.

5. **Write handoff** (if applicable): follow **agent-handoff** skill. Required for supervising agents (enforced by Stop hook). Optional for subordinate agents. Specialist agents write to a handoff doc (e.g., `docs/handoffs/specialist-latest.md`).

6. **Close session.**

   ```text
   action(type: "session/close")
   ```

   If this is the **last remaining session** in the pool, use `force: true`:

   ```text
   action(type: "session/close", force: true)
   ```

7. **Stop.** No more tool calls after `action(type: "session/close")`.

> **Subordinate agents:** After `action(type: "session/close")`, stop immediately. CLI process terminated externally by the supervising agent via session PID file. Don't loop, retry, or continue.

## Governor Shutdown (Governor Session Only)

1. **Drain queue.** `dequeue(max_wait: 0)` until empty. ALWAYS drain before closing.

2. **Wipe session memory file.**

3. **Tell other sessions to close.** DM each: *"Shutting down — close your session."* They drain queues and `close_session` on their own.

4. **Wait for `session_closed` events** from all sessions (brief timeout).

5. **Write session log.** Create `logs/session/YYYYMM/DD/HHmmss/summary.md`.

6. **Commit everything.** `git add` session log + pending changes. Commit with descriptive message.

7. **Acknowledge operator.** Brief voice message confirming saved and committed.

8. **Call `action(type: "shutdown")`.** Triggers MCP bridge graceful shutdown. Bridge dumps session timeline to local log (step 8 in `shutdown.ts`) — filed at start of next session.

## Supervising Agent: Subordinate Kill Procedure

After the subordinate calls `close_session`:

1. Read the session PID file for the subordinate agent (path specified in agent instructions or spawn output).
2. Kill process:
   ```powershell
   $agentPid = Get-Content "<session-memory-file>"
   Stop-Process -Id $agentPid -Force -ErrorAction SilentlyContinue
   ```
3. Delete PID file:
   ```powershell
   Remove-Item "<session-memory-file>" -ErrorAction SilentlyContinue
   ```
4. Confirm gone: `Get-Process -Id $agentPid -ErrorAction SilentlyContinue` returns nothing.

PID file absent → process already exited cleanly. No action needed.

> Paths relative to your workspace root.

## Safety

- `action(type: "session/close")` closes **YOUR** session only. No `target_sid`. Never use to close another agent's session.
- PID files written by the spawn script at launch; persist until the supervising agent deletes them via the subordinate kill procedure.

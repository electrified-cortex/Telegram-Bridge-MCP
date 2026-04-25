---
name: telegram-mcp-graceful-shutdown
description: >-
  Graceful shutdown procedure for Telegram bridge MCP agents. Use when an agent
  receives a shutdown signal and needs to cleanly exit its session.
compatibility: "Requires Telegram MCP bridge"
---

# Telegram MCP Graceful Shutdown

Clean exit for Telegram-enabled agents. Steps vary by role — governor (Curator) has additional responsibilities.

## Common Shutdown (All Agents)

Triggered by: operator stop or `action(type: "shutdown/warn")` DM from governor.

1. **Drain queue.** `dequeue(timeout: 0)` loop until `pending` = 0 and response = `empty`. ALWAYS drain before closing — unread messages lost when session ends.

2. **Finish current step.** Don't drop mid-operation.

3. **DM superior** with brief status:
   - Worker → Overseer: *"Worker $Id shutting down."*
   - Overseer → Curator: *"Overseer shutting down — pipeline status: [summary]."*
   - Specialist → Governor: *"Claw Expert shutting down."*

4. **Wipe session memory file.** Overwrite with empty content via memory tool. Clears token so next launch sees empty file → clean start. Don't skip — stale session file causes next launch to offer resume on dead session.

5. **Write handoff** (if applicable): follow **agent-handoff** skill. Required for Overseer and Sentinel (enforced by Stop hook). Optional for Workers. Specialists write to handoff doc (e.g., `docs/handoffs/claw-expert-latest.md`).

6. **Close session.**

   ```text
   action(type: "session/close")
   ```

7. **Stop.** No more tool calls after `action(type: "session/close")`.

> **Workers:** After `action(type: "session/close")`, stop immediately. CLI process terminated externally by Overseer via PID file at `.agents/agents/worker/<Worker-N>.pid`. Don't loop, retry, or continue.

## Governor Shutdown (Curator Only)

1. **Drain queue.** `dequeue(timeout: 0)` until empty. ALWAYS drain before closing.

2. **Wipe session memory file.**

3. **Tell other sessions to close.** DM each: *"Shutting down — close your session."* They drain queues and `close_session` on their own.

4. **Wait for `session_closed` events** from all sessions (brief timeout).

5. **Write session log.** Create `logs/session/YYYYMM/DD/HHmmss/summary.md`.

6. **Commit everything.** `git add` session log + pending changes. Commit with descriptive message.

7. **Acknowledge operator.** Brief voice message confirming saved and committed.

8. **Call `action(type: "shutdown")`.** Triggers MCP bridge graceful shutdown. Bridge dumps session timeline to local log (step 8 in `shutdown.ts`) — filed at start of next session.

## Overseer: Worker Kill Procedure

After Worker calls `close_session`:

1. Read PID file: `.agents/agents/worker/<Worker-N>.pid`
2. Kill process:
   ```powershell
   $workerPid = Get-Content ".agents/agents/worker/Worker-N.pid"
   Stop-Process -Id $workerPid -Force -ErrorAction SilentlyContinue
   ```
3. Delete PID file:
   ```powershell
   Remove-Item ".agents/agents/worker/Worker-N.pid" -ErrorAction SilentlyContinue
   ```
4. Confirm gone: `Get-Process -Id $workerPid -ErrorAction SilentlyContinue` returns nothing.

PID file absent → process already exited cleanly. No action needed.

> Paths relative to your workspace root.

## Safety

- `action(type: "session/close")` closes **YOUR** session only. No `target_sid`. Never use to close another agent's session.
- PID files written by `spawn.ps1` at launch; persist until Overseer deletes them via Worker Kill Procedure.

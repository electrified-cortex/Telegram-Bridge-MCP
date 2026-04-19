Graceful Shutdown — Clean exit for Telegram-enabled agents.

Triggered by: operator stop command or action(type: "shutdown/warn") DM from governor.

## Common Shutdown (All Agents)
1. Drain queue. dequeue(max_wait: 0) loop until pending = 0 and response = empty.
   ALWAYS drain — unread messages lost when session ends.
2. Finish current step. Don't drop mid-operation.
3. DM superior with status:
   - Worker → Overseer: "Worker $Id shutting down."
   - Overseer → Curator: "Overseer shutting down — pipeline: [summary]."
   - Specialist → Governor: "[Name] shutting down."
4. Wipe session memory file. Overwrite with empty content.
   Prevents next launch from offering resume on dead session.
5. Write handoff (if applicable). Required: Overseer, Sentinel. Optional: Workers.
6. action(type: "session/close") — closes YOUR session only. No target_sid.
7. Stop. No more tool calls after session/close.

## Governor Shutdown (Curator Only)
1. Drain queue. dequeue(max_wait: 0) until empty.
2. Wipe session memory file.
3. DM each session: "Shutting down — close your session."
4. Wait for session_closed events (brief timeout).
5. Write session log: logs/session/YYYYMM/DD/HHmmss/summary.md
6. Commit: git add session log + pending changes.
7. Acknowledge operator (brief voice message).
8. action(type: "shutdown") — triggers MCP bridge graceful shutdown.

## Overseer: Worker Kill Procedure
After Worker calls close_session:
  Read .agents/agents/worker/<Worker-N>.pid → Stop-Process -Id $pid -Force
  Delete PID file. Confirm gone.
PID file absent → process already exited. No action needed.

Safety: session/close closes YOUR session only. Never pass target_sid.

Full reference: skills/telegram-mcp-graceful-shutdown/SKILL.md

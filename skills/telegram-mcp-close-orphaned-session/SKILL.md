---
name: telegram-mcp-close-orphaned-session
description: Procedure for closing an orphaned Worker session (no active agent, session still registered in bridge)
---

# Skill: Close Orphaned Session

Use when a Worker session is registered in the bridge but no active agent is connected —
for example, after a terminal exit, forced kill, or operator-denied reconnect.

## When to use

- `list_sessions` shows a Worker session but the Worker is unresponsive to DMs
- Operator asks you to clean up a dangling session
- Worker terminal exited and operator denied reconnect

## Procedure

1. **Get the orphaned session's name and SID** from `action(type: "session/list")` or memory.

2. **Reconnect using the session's name with `reconnect: true`:**
   ```
   action(type: "session/start", name: "<WorkerName>", reconnect: true)
   ```
   This triggers an operator approval dialog. Wait for the operator to approve.

3. **Once approved, `session_start` returns `{ token, sid, pin, ... }`.**

4. **Immediately close the session:**
   ```
   action(type: "session/close", token: <token>)
   ```

5. **Confirm to the operator** that the session is closed.

## Notes

- Only close sessions where you are certain no active agent is running. Closing an
  active agent's session mid-task would corrupt their work.
- The operator must approve the reconnect — this is intentional. It prevents agents
  from closing each other's sessions without authorization.
- After closing, the SID is gone. A fresh Worker spawn gets a new SID.
- Known Worker session tokens are saved in memory — but a `reconnect: true` call
  bypasses token knowledge, so you don't need the old token to perform this procedure.

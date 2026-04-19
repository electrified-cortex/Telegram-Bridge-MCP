Close Orphaned Session — Clean up a registered session with no active agent.

Use when: session appears in list but agent is unresponsive (terminal exit, forced kill,
operator-denied reconnect).

## When to Use
- list_sessions shows a Worker session, Worker unresponsive to DMs.
- Operator asks to clean up a dangling session.
- Worker terminal exited and operator denied reconnect.

## Procedure
1. Get orphaned session name and SID from action(type: "session/list") or memory.
2. Reconnect as that session:
     action(type: "session/start", name: "<WorkerName>", reconnect: true)
   Triggers operator approval dialog. Wait for approval.
3. session/start returns { token, sid, ... }.
4. Immediately close:
     action(type: "session/close", token: <token>)
5. Confirm to operator that session is closed.

## Notes
- Only close sessions where no active agent is running.
  Closing an active agent's session mid-task corrupts their work.
- Operator must approve reconnect — intentional, prevents unauthorized closure.
- After close, SID is gone. Fresh Worker spawn gets new SID.
- reconnect: true bypasses token knowledge — old token not needed.

Full reference: skills/telegram-mcp-close-orphaned-session/SKILL.md

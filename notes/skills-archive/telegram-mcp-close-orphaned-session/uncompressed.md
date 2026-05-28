# telegram-mcp-close-orphaned-session — uncompressed

## What this skill governs

The procedure for closing a bridge session that is registered in the bridge but has no active agent process attached. Orphaned sessions accumulate when an agent's host process exits without calling `session/close`. They consume bridge resources and confuse routing.

The bridge cannot unilaterally close sessions that a governor still owns — the governor must explicitly retake the orphan via reconnect and then shut it down cleanly.

## When to run this skill

Run when ALL of the following hold:
- `session/list` shows a session with no recent activity.
- The session is unresponsive to direct DMs across at least one full reminder cycle.
- The operator has requested cleanup, OR you have confirmed the agent's host process is gone.

Do NOT run this speculatively. Closing an active agent's session mid-task corrupts their work.

## Who runs this skill

A governor-class session (or the operator directly via the bridge UI). Non-governor sessions do not close peer sessions.

## Procedure (ordered)

```text
1. Identify orphan.
   Get name + SID via action(type: "session/list") or memory.

2. Reconnect to retake control.
   action(type: "session/start", name: "<OrphanName>", reconnect: true)
   This triggers an operator approval dialog. WAIT for the operator to approve.
   Reconnect is a governor-supervised step — operator approval is non-bypassable.

3. After approval, session/start returns { token, sid, pin, ... }.
   The returned SID is the same as the orphan's SID.

4. Drain any pending updates.
   dequeue(max_wait: 0)

5. Close the session.
   action(type: "session/close")

6. Confirm to operator that the session is closed.
```

## Key behaviors

- Operator approval at step 2 is the safety gate against rogue session takeover. Never attempt to bypass it.
- After `session/close`, the SID is gone. A fresh spawn of the same agent role gets a new SID.
- You do not need the prior session's token to perform this procedure — `reconnect: true` bypasses token knowledge.

## Cross-references

- What `session/close` actually does: `telegram-mcp-graceful-shutdown`.
- Routine graceful shutdown: `telegram-mcp-graceful-shutdown`.
- Your own forced-stop recovery: `telegram-mcp-forced-stop-recovery`.

## Don'ts

- Do not close a session without confirming it is genuinely orphaned (unresponsive to DMs).
- Do not attempt alternative paths (direct database edits, bridge restarts) — reconnect-then-close is the only sanctioned route.
- Do not include workspace-specific naming, paths, or role hierarchies here.

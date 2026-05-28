# telegram-mcp-graceful-shutdown — uncompressed

## What this skill governs

The ordered shutdown procedure for a Telegram bridge MCP agent receiving a stop signal. Graceful shutdown preserves unread messages, signals superior agents, and releases the session cleanly.

Applies when the agent receives:
- An operator-issued stop or close directive.
- A `shutdown/warn` DM from a governor session.
- A clear wrap-up directive in conversation.

Not covered: forced stop (`telegram-mcp-forced-stop-recovery`), compaction recovery (`telegram-mcp-post-compaction-recovery`), stop hook handling (`telegram-mcp-stop-hook-recovery`), bridge-level shutdown protocol (`telegram-mcp-shutdown-protocol`).

## Common shutdown sequence (all agents)

```text
1. Drain queue.
   dequeue(max_wait: 0) loop until pending == 0 and response is empty.
   ALWAYS drain — unread messages are lost on session close.
   Draining is non-optional. Time pressure does not justify dropping messages.

2. Finish current step.
   Do not drop a mid-operation task.

3. DM superior (if applicable).
   Brief status line: "<Role> shutting down. [state summary if relevant]."

4. Wipe session token from memory file.
   Overwrite the session memory file with empty content.
   Stale token causes the next launch to attempt resume on a dead session.

5. Call session/close.
   action(type: "session/close")
   If this is the last remaining session in the pool, use force: true.

6. Exit the loop.
   Stop dequeuing. No more tool calls after session/close returns.
```

## Governor-class additions

Governors (one per session pool) have additional responsibilities before closing:

```text
a. After draining queue: signal all peer sessions to close.
   Send each peer: "Shutting down — close your session."
   Each peer drains its own queue and calls session/close independently.

b. Wait briefly for session_closed events from peers.

c. Write session log artifact.

d. Commit any staged changes.

e. Acknowledge operator that shutdown is complete.

f. Call action(type: "shutdown") to begin bridge teardown.
   NOTE: only the governor calls bridge-wide shutdown.
   Non-governor agents NEVER call action(type: "shutdown").
```

See `telegram-mcp-shutdown-protocol` for the bridge-level shutdown handshake.

## Non-governor agents

Close your own session and exit. Your superior closes after. Do not call bridge-wide shutdown.

## `force: true`

Required when this is the last session remaining in the pool. The bridge needs it to release cleanly when no other sessions are present.

## Two states only

In-loop or closed. There is no soft-close, partial shutdown, or "I'll finish this first" state that delays the drain step.

## Don'ts

- Do not skip the drain step under any circumstance.
- Do not enumerate workspace handoff doc paths or workspace conventions here.
- Do not invoke bridge-wide `shutdown` from a non-governor session.
- Do not introduce partial or soft close states.

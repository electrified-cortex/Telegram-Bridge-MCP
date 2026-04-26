# telegram-mcp-shutdown-protocol — uncompressed

## What this skill governs

The bridge-level shutdown handshake — the protocol agents follow when the bridge announces a planned or forced shutdown via dequeue. This is NOT a per-agent graceful close; it is the bridge-to-fleet broadcast that the entire bridge process is going down.

Not covered: per-agent graceful shutdown invoked by an operator stop directive (`telegram-mcp-graceful-shutdown`), stop hook handling (`telegram-mcp-stop-hook-recovery`), forced-stop recovery (`telegram-mcp-forced-stop-recovery`).

## When this protocol applies

When an agent receives a shutdown warning event in `dequeue`, including:
- Planned shutdown announced by the operator or governor.
- Forced shutdown via `action(type: "shutdown", force: true)`.
- Bridge process restart events.

## Protocol (ordered — all agents)

```text
1. Wipe token.
   Clear session token from in-memory state AND from the session memory file.
   Token-wipe comes FIRST — this is the signal to the loop guard that the
   session is no longer active. If the host's stop hook or loop guard prevents
   termination, an empty token file lets it recognize the session as inactive
   instead of blocking exit.

2. Close session.
   action(type: "session/close")

3. Exit loop.
   Stop dequeuing. End the agent's turn.
```

## Planned vs forced shutdown

### Planned (countdown announced)

```text
action(type: "shutdown", countdown: 120)
```

Sends warning to all sessions, waits N seconds, then shuts down. Default: 120 s. Agents have the countdown window to finish atomic operations in progress.

The governor can also warn without immediately shutting down:
```text
action(type: "shutdown/warn", reason: "planned restart")
```

On receiving a planned warning: finish the current atomic operation (do not start new work), then execute the wipe -> close -> exit sequence.

### Forced (immediate)

```text
action(type: "shutdown", force: true)
# or countdown: 0
```

Agents skip wrap-up steps and execute the protocol immediately. Do NOT compose a final message to the operator during a forced shutdown — the bridge is going down anyway.

## Token-wipe rationale

Wipe-first ensures that even if the host's loop guard runs between `session/close` and actual process exit, the empty token file prevents the guard from re-blocking exit. This is why token wipe is always step 1, not step 2 or after close.

## After shutdown

Planned restart: agents with spawn scripts detect the bridge is down, wait, then retry.
Permanent shutdown: agents exit cleanly because their token is wiped — the loop guard will not block exit when the token file is empty.

## Cross-reference

`telegram-mcp-graceful-shutdown` for the per-agent close call detail.

## Don'ts

- Do not ignore a forced-shutdown warning to finish current work. Forced means immediate.
- Do not introduce a confirmation dialog — shutdown is one-way.
- Do not bake workspace-anchored paths for token files — use "session memory file" abstractly.

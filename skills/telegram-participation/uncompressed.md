---
name: telegram-participation
description: >-
  Bootstrap any TMCP-enabled agent into an active Telegram session — connection
  check, session anchor, startup drain, post-connect setup, and dequeue loop.
  Load on startup/resume; invoke on-demand to re-anchor. Triggers - join
  Telegram, telegram presence, sign on telegram, telegram loop, re-anchor
  session.
---

# telegram-participation — uncompressed

## What this skill governs

The complete bootstrap sequence for an agent participating in a TMCP-brokered Telegram session. Covers: connection check, session anchoring (fresh start and reconnect), startup drain, post-connect setup, and the dequeue loop.

Load this skill on every startup and resume. Invoke it on demand to re-anchor (e.g., after a forced-stop recovery).

Everything post-connection — profile load, monitor arm, shutdown sequence — is delegated to bridge `help()` topics. This skill is the launch pad; the bridge is the guide.

## R1 — Connection check

Check whether TMCP is reachable before making any session calls.

- TMCP unreachable → notify operator; report unavailable; stop.
- TMCP reachable → proceed to R2.

## R2 — Session anchor

### Fresh start (no token)

```mcp
action(type: 'session/start', name: '<AgentName>')
```

Triggers an operator approval dialog (blocking, up to 120 seconds). If the operator approves, a new token is returned — store it, then continue to R3. If the operator denies or the dialog times out: notify the operator, report unavailable, and stop.

### Token present

Probe the live session without side effects:

```mcp
action(type: 'reminder/list', token: <stored token>)
```

- **On success:** session is live; continue to R3.
- **On `AUTH_FAILED` or invalid token:** the token is stale. Reconnect:

  ```mcp
  action(type: 'session/reconnect', name: '<AgentName>')
  ```

  Same approval dialog (up to 120s). On approval: store new token; continue to R3. Denied/timeout: notify; stop.
- **On unexpected error:** notify the operator; report unavailable; stop.

## R3 — Startup drain

Before post-connect setup, drain the queue for any messages that arrived during startup:

```mcp
dequeue(max_wait: 0)
```

This is a single non-blocking call — do not loop. If a `post_compact_monitor_recovery` event is in the batch, your context was recently compacted — call `help('compacted')` before proceeding to R4. The compaction recovery topic handles monitor re-arm and verification.

## R4 — Post-connect setup

**Step 1 — Profile load:**

```mcp
action(type: 'profile/load', key: '<agent-name>')
```

Load the agent's own profile — voice, animation presets, reminders. Use the pod's own identifier (e.g. `bt`, `curator`, `zhuli`, `overseer`). MUST use the agent's own key; never another session's key. Idempotent — safe to re-call after compaction. Must run after R2 (session anchor complete) and before the monitor arm.

**Step 2 — Boot animation:**

```mcp
send(type: 'animation', preset: 'working', timeout: 60, token: <token>)
```

The earliest visible presence signal once a session is anchored. Without it, the operator sees nothing for the several seconds it takes the agent to finish setup (monitor arm, defaults). 60-second temporary animation — auto-clears, or is naturally superseded by the agent's first real send. Must fire after Step 1 (profile/load provides the voice/animation settings the session will use).

**Step 3 — Setup delegation:**

```mcp
help('startup')
```

Covers activity monitor arm and dequeue defaults. Must run after the session is anchored (R2 complete) and after the boot animation fires (Step 2). Profile load is now handled explicitly in Step 1 and need not be repeated here.

## R5 — Dequeue loop

End every agent turn with a dequeue call:

```mcp
dequeue(token)
```

Use no explicit `max_wait` — the session default applies (loaded via `profile/load` in R4 Step 1, confirmed by `help('startup')`). Do not override the session default via `profile/dequeue-default`. Drain polls (`max_wait: 0`) are permitted when needed.

## Closeout

Before any shutdown path — planned exit, shutdown directive, on-demand close:

1. Drain: `dequeue(max_wait: 0)` until empty.
2. `action(type: 'session/close', token)`. On `LAST_SESSION` error: retry with `force: true`.

## Don'ts

- Do not call `help('startup')` before the session is anchored (R2 must complete first).
- Do not call `profile/load` with another agent's key — always use the pod's own identifier.
- Do not loop the R3 drain — it is a single call.
- Do not override the session dequeue default via `profile/dequeue-default`.
- Every code path that ends the agent session must call `help('shutdown')`.

## Cross-references

- `help('startup')` — monitor arm, dequeue defaults (profile/load now explicit in R4 Step 1)
- `help('compacted')` — post-compaction monitor recovery
- `help('guide')` — communication patterns, etiquette, presence, animations
- `help('activity/file')` — activity file and watcher scripts in depth

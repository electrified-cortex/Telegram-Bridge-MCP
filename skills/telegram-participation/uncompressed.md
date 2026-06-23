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

The complete bootstrap sequence for an agent participating in a TMCP-brokered Telegram session. Covers: connection check, session anchoring (fresh start and reconnect), startup drain, post-connect setup, activity monitor arm and verification, the dequeue loop, and graceful shutdown.

Load this skill on every startup and resume. Invoke it on demand to re-anchor (e.g., after a forced-stop recovery).

## R1 — Connection check

Check whether TMCP is reachable before making any session calls.

| Condition | Action |
| --- | --- |
| TMCP unreachable, no token | Notify operator; report unavailable; stop. |
| TMCP unreachable, token present | Direct Connect mode; notify operator of TMCP unavailability; proceed to R2. |
| TMCP reachable | Proceed to R2. |

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
dequeue()
```

Call once at startup; handle any queued updates. If a `post_compact_monitor_recovery` event is in the batch, your context was recently compacted — call `help('compacted')` before proceeding to R4. The compaction recovery topic handles monitor re-arm and verification.

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

## R5 — Activity monitor arm

Arm the activity file watcher so the session has an activity signal. Two entry paths depending on whether a prior registration survives.

**Branch A — compaction recovery:**

```mcp
action(type: 'activity/file/get')
```

If the response includes a `file_path`, a prior registration survives — use it and skip Branch B. If no `file_path` is returned, fall through to Branch B.

**Branch B — fresh start:**

```mcp
action(type: 'activity/file/create')
```

Then call `dequeue()` and scan the batch for an event with `event_type: 'ACTIVITY_FILE_MONITOR_INSTRUCTIONS'`. Extract `file_path` from that event.

**ALREADY_REGISTERED response (either branch):**

- `details.file_path` non-empty → use it; proceed to path construction.
- `details.file_path` empty → `action(type: 'activity/file/delete')`, then re-run Branch B from scratch.

**Path construction and arm:**

1. If `file_path` contains backslash (`\`) separators, convert to POSIX (forward slash) first.
2. TMCP root = 3 parent directories up from `file_path` (i.e., `dirname(dirname(dirname(file_path)))`).
3. Stop any previously running watcher, then arm: `<TMCP_root>/tools/monitor.sh <file_path>`.

Retain the watcher handle for use during shutdown (R8).

## R6 — Monitor verification

After arming, verify the watcher is live before proceeding to the dequeue loop.

1. Send a self-DM — this triggers an update to the activity file.
2. Wait up to 30 seconds for the watcher to emit a signal (file change notification).
   - Signal received → monitor is live; proceed to R7.
   - No signal within 30s → re-arm: `action(type: 'activity/file/delete')`, then `action(type: 'activity/file/create')`; re-arm the watcher.

## R7 — Dequeue loop

End every agent turn with a dequeue call:

```mcp
dequeue(token)
```

Session default applies (loaded via `profile/load` in R4 Step 1, confirmed by `help('startup')`). Do not override the session default via `profile/dequeue-default`.

## R8 — Closeout

R8 MUST run on ALL shutdown paths — planned exit, shutdown directive, forced stop. Skipping any step risks leaving orphaned registrations or an unclosed session.

**Step 1 — Stop watcher:**
Stop the file watcher using the retained handle (from R5). If the handle is unavailable (e.g., after a compaction that didn't preserve it), call `action(type: 'activity/file/delete')` instead.

**Step 2 — Drain queue:**
Call `dequeue()` and handle any remaining messages before closing.

**Step 3 — Clear token:**
Capture the stored session token into a local variable, then clear it from state. This ensures the token is available for the close call but is not retained afterward.

**Step 4 — Close session:**

```mcp
action(type: 'session/close', token: <captured>)
```

On `LAST_SESSION` error: retry once with `force: true`.

## Don'ts

- Do not call `help('startup')` before the session is anchored (R2 must complete first).
- Do not call `profile/load` with another agent's key — always use the pod's own identifier.
- Do not loop the R3 drain — it is a single call.
- Do not override the session dequeue default via `profile/dequeue-default`.
- R8 must run on every shutdown path — do not skip or short-circuit.

## Cross-references

- `help('startup')` — monitor arm, dequeue defaults (profile/load now explicit in R4 Step 1)
- `help('compacted')` — post-compaction monitor recovery
- `help('guide')` — communication patterns, etiquette, presence, animations
- `help('activity/file')` — activity file and watcher scripts in depth

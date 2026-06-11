---
name: telegram-participation
description: >-
  Bootstrap any TMCP-enabled agent into an active Telegram session — connection
  check, session anchor, startup drain, post-connect setup, and dequeue loop.
  Load on startup/resume; invoke on-demand to re-anchor. Triggers - join
  Telegram, telegram presence, sign on telegram, telegram loop, re-anchor
  session.
---

Bootstrap an agent into a TMCP-brokered Telegram session and keep it in the loop.

## R1 — Connection check

| Condition | Action |
| --- | --- |
| TMCP unreachable, no token | Notify operator; report unavailable; stop. |
| TMCP unreachable, token present | Direct Connect mode; notify operator of TMCP unavailability; proceed to R2. |
| TMCP reachable | Proceed to R2. |

## R2 — Session anchor

**No token (fresh start):** `action(type: 'session/start', name: '<AgentName>')`
Operator approval dialog (up to 120s). Approved → store token; R3. Denied/timeout → notify; stop.

**Token present:** probe: `action(type: 'reminder/list', token: <token>)`.
- Success → session live; R3.
- `AUTH_FAILED` or invalid token → `action(type: 'session/reconnect', name: '<AgentName>')`; store new token; R3.
- Unexpected error → notify operator; stop.

## R3 — Startup drain

`dequeue(max_wait: 0)` — single non-blocking call. If a `post_compact_monitor_recovery` event is in the batch, call `help('compacted')` before continuing.

## R4 — Post-connect setup

`action(type: 'profile/load', key: '<agent-name>')` — load own profile (voice, animation, reminders). Use the pod's own identifier (e.g. `bt`, `curator`, `zhuli`, `overseer`). Idempotent; safe after compaction.

`send(type: 'animation', preset: 'working', timeout: 60, token: <token>)` — fire next, before any further setup, so the operator sees a presence signal during the remainder of boot. 60s temp auto-clears.

Then `help('startup')` — covers monitor arm and dequeue defaults.

## R5 — Activity monitor arm

**SSE check (try first):** `action(type: 'activity/listen')`.
- Returns `ok: true` → HTTP mode active. Arm: `Monitor(command: "<command from response>", persistent: true, description: "Telegram SSE notifier")`. Skip to R6.
- Returns `HTTP_MODE_REQUIRED` → fall through to Branch A/B below (file-watch path).

**Branch A — compaction recovery (file-watch path):** `action(type: 'activity/file/get')`.
- Returns a `file_path` → skip Branch B; proceed to path construction.
- Returns no `file_path` → fall through to Branch B.

**Branch B — fresh start (file-watch path):** `action(type: 'activity/file/create')`, then `dequeue(max_wait: 10)` scanning for `event_type: 'ACTIVITY_FILE_MONITOR_INSTRUCTIONS'`. Extract `file_path` from that event.

**ALREADY_REGISTERED response (either branch):**
- `details.file_path` non-empty → use it; proceed to path construction.
- `details.file_path` empty → `action(type: 'activity/file/delete')`, then re-run Branch B.

**Path construction and arm (file-watch path):**
1. If `file_path` contains backslash (`\`) separators, convert to POSIX (forward slash) first.
2. TMCP root = 3 parent directories up from `file_path`.
3. Stop any running watcher, then arm: `<TMCP_root>/tools/monitor.sh <file_path>`.

## R6 — Monitor verification

1. Send a self-DM to trigger an activity file update.
2. Wait up to 30s for the watcher to emit a signal.
   - Signal received → monitor live; continue.
   - No signal → re-arm: `action(type: 'activity/file/delete')`, then `action(type: 'activity/file/create')`; re-arm watcher.

## R7 — Dequeue loop

**When your monitor fires:** handle messages one at a time until there are no pending messages (`pending = 0`). Then stop — do not re-enter the dequeue loop. Your monitor will bring you back when the next message arrives.

**Without monitor (fallback only):** blocking dequeue loop (`dequeue(token)` with session default) is acceptable. Verify session default ≥ 90 s on startup. Never specify `max_wait` unless you have a clear reason — too-short values burn one full API turn per interval with no message processed.

## R8 — Closeout

R8 MUST run on ALL shutdown paths (planned exit, shutdown directive, forced stop).

1. **Stop watcher:** by retained handle; if handle unavailable, `action(type: 'activity/file/delete')`.
2. **Drain (capped at 10):** `dequeue(max_wait: 0)` up to 10 iterations until empty.
3. **Clear token:** capture stored token, then clear it from state.
4. **Close session:** `action(type: 'session/close', token: <captured>)`. On `LAST_SESSION` error: retry with `force: true`.

## Breadcrumbs

- `help('startup')` — monitor arm, dequeue defaults (profile/load now explicit in R4)
- `help('compacted')` — post-compaction monitor recovery
- `help('guide')` — communication patterns, etiquette, presence
- `help('index')` — full topic menu

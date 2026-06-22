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

**SSE-primary transport.** Arm SSE as the SOLE transport when it is available. File-watch is a break-glass FALLBACK, armed ONLY when SSE is unavailable. Do NOT co-arm both — SSE is reliable (bridge >= v7.11.0), and arming both double-fires every event (one SSE notify + one file-watch kick). [Changed 2026-06-14 per operator: stop the double-kick; SSE proven, file-watch fallback only.]

**Step 1 — SSE:** `action(type: 'activity/listen')`.
- Returns `ok: true` → HTTP mode active. **Host-rewrite first:** inspect the `command` in the response — if it contains `0.0.0.0`, replace it based on your environment:
  - **Container pod** (running inside Docker on agents host — BT, Zhu-Li, etc.): replace with `bridge`
  - **Host pod** (running directly on host OS — Curator, Overseer, etc.): replace with `127.0.0.1`
  - Rule of thumb: if your pod root is under `/opt/stacks/`, use `bridge`; if under a user home dir, use `127.0.0.1`.
  Arm: `Monitor(command: "<rewritten command>", persistent: true, description: "Telegram SSE notifier")`. Retain the task ID. **SSE is now your SOLE transport — SKIP Step 2 and proceed to R6. Do NOT arm file-watch.**
- Returns `HTTP_MODE_REQUIRED` (SSE unavailable) → skip Step 1 arm; continue to Step 2 (file-watch FALLBACK).

**Step 2 — File-watch (FALLBACK ONLY — reach here only if Step 1 returned `HTTP_MODE_REQUIRED` / SSE unavailable):** proceed to Branch A/B below.

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

Retain the task ID from the Monitor() call (SSE in normal operation; file-watch only in fallback mode). In normal SSE-only operation there is a single monitor.

**SSE verification (solo-capable):**
```
POST /activity/selftest   ?token=<your-token>
```
Returns `{ ok: true }` → SSE stream is live and notify was injected (your SSE monitor should fire within seconds).
Returns `{ ok: false, error: "NO_SSE_CONNECTION" }` → SSE not armed; re-run Step 1.

**File-watch re-arm (if no fire within expected window):** `action(type: 'activity/file/delete')`, then `action(type: 'activity/file/create')`; re-arm watcher.

**SSE health (ongoing):** If SSE monitor fires keepalives (`: keepalive`) continuously but `data: notify` never arrives despite real messages → SSE registration was lost (bridge stopped routing to your subscription). Fix: re-call `action(type: 'activity/listen')` and re-arm the SSE monitor. File-watch is unaffected and continues delivering independently.

## R7 — Dequeue loop

**When your monitor fires:** call `dequeue()`. Handle the returned updates. Call `dequeue()` again immediately. Repeat until `timed_out: true` — that is the only stop signal. Do not stop on `pending = 0`.

**After any outbound send:** call `dequeue()` again immediately — do not idle or wait for SSE. A send is not a loop exit; only `timed_out: true` is.

While this loop is running, incoming messages (from any source — operator, peers, other monitors) arrive directly into the blocking `dequeue()` call. SSE notifies during an active loop are redundant and expected — the dequeue catches everything first. **SSE is only needed to wake the agent after the loop has timed out.**

The session-default timeout (~90 s) is what allows other messages to arrive without extra SSE overhead, prevents excessive notifications, and maintains readiness.

**Without monitor (fallback only):** same blocking loop pattern — `dequeue()` continuously. `timed_out: true` just means no message this window; call `dequeue()` again immediately. There is no SSE to wait for — you always end with `dequeue()`.

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

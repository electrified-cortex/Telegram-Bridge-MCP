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

TMCP unreachable → notify operator; report unavailable; stop.
TMCP reachable → R2.

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

`send(type: 'animation', preset: 'working', timeout: 60, token: <token>)` — fire first, before any further setup, so the operator sees a presence signal during the remainder of boot. 60s temp auto-clears.

Then `help('startup')` — covers profile load, monitor arm, and dequeue defaults.

## R5 — Dequeue loop

End every agent turn with `dequeue(token)`. Use session default.
Don't override via `profile/dequeue-default`. Drain polls (`max_wait: 0`) permitted.

## Closeout

Before any shutdown: drain the queue with `dequeue(max_wait: 0)`, then `action(type: 'session/close', token)`. On `LAST_SESSION` error: retry with `force: true`.

## Breadcrumbs

- `help('startup')` — profile, monitor, dequeue defaults
- `help('compacted')` — post-compaction monitor recovery
- `help('guide')` — communication patterns, etiquette, presence
- `help('index')` — full topic menu

# Feature: Governor Timeout → User Reroute Prompt

## Type

Feature / Reliability

## Priority

300

## Description

If the governor session (first session / primary) stops polling `dequeue_update` (crash, timeout, network loss), ambiguous messages pile up in its queue with no one handling them. The operator sees silence.

This task implements a **user-gated reroute**: the server tracks governor heartbeats and, when a timeout is detected, sends the operator a prompt asking whether to reroute messages to another available session.

## Current State

- `dequeue_update` is stateless — the server doesn't track when the last poll happened
- `session-manager.ts` tracks creation time but not last-active time
- Governor gets ALL ambiguous messages; no fallback when unresponsive

## Design

### Heartbeat Tracking

Every `dequeue_update` call records `lastPollAt = Date.now()` on the session. This is the heartbeat.

### Governor Timeout → User Prompt

A periodic health check (every 60s) inspects the governor session:

1. If governor hasn't polled within `THRESHOLD` (dequeue timeout + 60s buffer, ~360s):
   - Notify the operator via Telegram confirm: "⚠️ {governor name} appears unresponsive. Route new messages to {next session name}?"
   - If user confirms → temporarily route ambiguous messages to the suggested session
   - If user declines → leave messages queued for governor (they may recover)
   - **Three-option choose prompt:**
     1. "Route this message to {next session}" — one-time reroute only
     2. "Make {next session} the new primary" — permanent governor transfer
     3. "Wait for {governor name} to come back" — leave queued
   - On governor transfer: DM the new primary session: "You are now the primary session. Ambiguous messages will be routed to you."
2. If ANY non-governor session goes unhealthy:
   - Notify operator only — no routing change needed (workers don't get ambiguous messages anyway)

### Recovery

When the governor resumes polling:
- Automatically mark as `healthy`
- If it was the governor, it resumes governor duties (messages routed back to it)
- Notify operator: "✅ {name} is back online."

### No auto-close

Unhealthy sessions are NOT auto-closed. The operator decides. The session may recover.

## Code Path

1. `src/session-manager.ts` — Add `lastPollAt: number` and `healthy: boolean` to session record. Export:
   - `touchSession(sid)` — update `lastPollAt` and set `healthy = true`
   - `getUnhealthySessions(thresholdMs): Session[]`
   - `markUnhealthy(sid)` / `isHealthy(sid)`
2. `src/tools/dequeue_update.ts` — Call `touchSession(sid)` at start of every poll.
3. `src/health-check.ts` (new) — `setInterval(60_000)`:
   - Call `getUnhealthySessions(THRESHOLD)`
   - For newly unhealthy governor: send Telegram confirm to operator with reroute options
   - Track which sessions have already been flagged (don't re-notify)
4. `src/session-queue.ts` — No automatic reroute. Only reroute if operator confirms via the prompt.

## Acceptance Criteria

- [ ] `dequeue_update` records `lastPollAt` per session on every poll
- [ ] Health check runs periodically (configurable interval, default 60s)
- [ ] Governor timeout triggers operator confirm prompt with reroute options
- [ ] Operator confirms → messages rerouted to chosen session
- [ ] Operator declines → messages stay queued for governor
- [ ] Non-governor unhealthy → operator notification only, no reroute
- [ ] Recovery: session resumes healthy on next poll
- [ ] No auto-close — unhealthy sessions persist until manually closed
- [ ] Tests for timeout detection, user prompt, reroute on confirm, recovery
- [ ] All tests pass: `pnpm test`

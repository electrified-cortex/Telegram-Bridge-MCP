# Feature: Governor Timeout & Cascade Fallback (Heartbeat)

## Type

Feature / Reliability

## Priority

300

## Description

If the governor session stops polling `dequeue_update` (crash, timeout, network loss), ambiguous messages pile up in its queue with no one handling them. The operator sees silence.

This task implements a **governor-cascade hybrid**: sessions are ranked by SID (lowest = highest rank). The governor normally handles all ambiguous messages, but if it goes unresponsive, messages automatically cascade to the next-ranked session. When the governor recovers, it resumes automatically.

## Current State

- `dequeue_update` is stateless — the server doesn't track when the last poll happened.
- `session-manager.ts` tracks creation time but not last-active time.
- Governor mode routes ALL ambiguous messages to the governor. No fallback.
- Cascade mode exists as a separate routing mode but isn't used as a fallback.

## Design

### SID = Rank

SID order is rank: SID 1 is top (governor), SID 2 is first fallback, SID 3 is second fallback, etc. This is natural — the first session to join is the most trusted.

### Heartbeat tracking

Every `dequeue_update` call records `lastPollAt = Date.now()` on the session. This is the heartbeat.

### Governor timeout → cascade

A periodic health check (every 60s) inspects all sessions:

1. If governor hasn't polled within `THRESHOLD` (dequeue timeout + 60s buffer, ~360s):
   - Mark governor as `unhealthy`
   - Reroute NEW ambiguous messages to the next-ranked healthy session
   - DM the fallback session: `⚠️ Governor appears offline. You're handling ambiguous messages.`
   - Notify operator: `⚠️ {name} appears unresponsive.`
2. If ANY non-governor session goes unhealthy:
   - Notify operator only — no routing change needed (they don't get ambiguous messages anyway)
   - Their queued messages stay put (they'll process on recovery)

### Recovery

When an unhealthy session resumes polling:
- Automatically mark as `healthy`
- If it was the governor, it resumes governor duties (no notification — seamless)
- Messages queued during the outage stay with the fallback session that received them

### No auto-close

Unhealthy sessions are NOT auto-closed. The operator or overseer decides. The session may recover.

## Code Path

1. `src/session-manager.ts` — Add `lastPollAt: number` and `healthy: boolean` to session record. Export:
   - `touchSession(sid)` — update `lastPollAt` and set `healthy = true`
   - `getUnhealthySessions(thresholdMs): Session[]`
   - `markUnhealthy(sid)` / `isHealthy(sid)`
2. `src/tools/dequeue_update.ts` — Call `touchSession(sid)` at start of every poll.
3. `src/health-check.ts` (new) — `setInterval(60_000)`:
   - Call `getUnhealthySessions(THRESHOLD)`
   - For newly unhealthy governor: find next healthy session by SID order, reroute
   - Notify operator and fallback session
   - Track which sessions have already been flagged (don't re-notify)
4. `src/session-queue.ts` — `reroute(fromSid, toSid)` — move pending messages from one queue to another.
5. `src/routing-mode.ts` — `setFallbackGovernor(sid)` or similar to temporarily redirect without changing the actual governor setting.

## Acceptance Criteria

- [ ] `dequeue_update` records `lastPollAt` per session on every poll
- [ ] Health check runs periodically (configurable interval, default 60s)
- [ ] Governor timeout triggers cascade to next-ranked healthy session
- [ ] Fallback session receives DM notification about taking over
- [ ] Operator receives notification about unresponsive session
- [ ] Non-governor unhealthy → operator notification only, no reroute
- [ ] Recovery: session resumes healthy on next poll, governor resumes duties
- [ ] No auto-close — unhealthy sessions persist until manually closed
- [ ] Tests: governor timeout → cascade fallback
- [ ] Tests: recovery → governor resumes
- [ ] Tests: non-governor timeout → operator notification only
- [ ] Tests: health check interval fires correctly
- [ ] All tests pass: `pnpm test`

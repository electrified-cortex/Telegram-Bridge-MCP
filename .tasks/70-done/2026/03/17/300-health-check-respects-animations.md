# Feature: Health Check Respects Active Animations

## Type

Bug — Medium

## Found During

Multi-session manual testing (2026-03-18). Health check fired "⚠️ Overseer appears unresponsive" while the session had an active thinking animation.

## Current Behavior

`runHealthCheck()` in `src/health-check.ts` checks `getUnhealthySessions(thresholdMs)` which looks at `lastPollAt` — the timestamp of the last `dequeue_update` call. If that timestamp is older than `HEALTH_THRESHOLD_MS` (360s), the session is flagged as unresponsive.

It does NOT consider whether the session has an active animation, which is explicit proof of life — the session called `show_animation` recently and is working on something.

## Root Cause

The health check only looks at `lastPollAt` from `dequeue_update`. A session doing intensive work (investigation, code generation, file reads) may not poll for several minutes while actively showing a working/thinking animation.

## Fix

In `runHealthCheck()`, skip sessions that have an active animation:

```typescript
import { hasActiveAnimation } from "./animation-state.js";

// In the unhealthy loop:
if (hasActiveAnimation(session.sid)) continue; // animation = proof of life
```

This requires exporting a `hasActiveAnimation(sid)` function from `animation-state.ts` (currently `_states` is module-private).

## Alternative

Also update the health threshold concept: any tool call (not just `dequeue_update`) should count as "alive". `show_animation`, `send_text`, `confirm`, etc. all prove the session is active. Could add a `touchSession(sid)` call to the `requireAuth` path or the middleware.

## Acceptance Criteria

- [ ] Sessions with active animations are not flagged as unresponsive
- [ ] Export `hasActiveAnimation(sid): boolean` from animation-state
- [ ] Health check recovery still works when animation ends and session resumes polling
- [ ] All tests pass

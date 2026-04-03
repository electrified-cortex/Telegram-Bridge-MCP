---
Created: 2026-04-03
Status: Draft
Priority: 15
Source: Operator directive (voice)
Repo: electricessence/Telegram-Bridge-MCP
Branch target: dev
Related: 10-196
---

# 15-197: Agent Reconnect Protocol

## Context

Operator identified that agents currently lack a clean way to drop and reconnect
to the bridge. When the bridge restarts, or when an agent's context compacts,
the reconnect flow is fragile and undocumented as a formal protocol.

Operator quote: "A reconnect protocol. Maybe, you know, bots being able to drop
and then reconnect would be good."

## Goal

Define and implement a formal reconnect protocol that agents can follow to
gracefully disconnect and re-establish their session, preserving identity and
catching up on missed updates.

## Current State

- `session_start(reconnect: true)` exists but behavior is informal
- No guarantee about what state survives across reconnect
- No "catch-up" mechanism for updates missed during disconnect
- Agents currently rely on ad-hoc error handling when the bridge disappears

## Proposed Protocol

### Agent-Initiated Disconnect
```
1. Agent calls close_session (or just stops calling dequeue_update)
2. Bridge marks session as "dormant" (not deleted)
3. Session state preserved for configurable TTL (e.g., 30 minutes)
```

### Agent-Initiated Reconnect
```
1. Agent calls session_start(reconnect: true, sid: X, pin: Y)
2. Bridge validates credentials against dormant session
3. If valid: session reactivated, missed updates queued for delivery
4. If expired: session_start returns error, agent must create new session
```

### Bridge-Initiated Disconnect (bounce)
```
1. Bridge sends shutdown_warning to all sessions
2. Agents receive warning via dequeue_update
3. Bridge shuts down
4. Agents detect disconnect (dequeue_update fails / times out)
5. Agents retry session_start(reconnect: true) with backoff
6. Bridge restarts, accepts reconnections
```

## Operator Vision — Smart Reconnect Flow (voice, 21948)

The operator described a complete agent-side reconnect algorithm:

```
1. Agent starts up (fresh or after sleep)
2. Probe: call list_sessions WITHOUT a PIN → get active SID list only
3. Decision tree:
   a. My SID is NOT in the list → bridge restarted → fresh start (new session)
   b. My SID IS in the list:
      i.  Try session_start(reconnect: true, sid: X, pin: Y)
      ii. PIN accepted → resume (no operator interaction needed)
      iii. PIN rejected → someone else has my session → ask operator
           "Do you want me to take over this session?"
   c. Keep getting rejected → exit (prevent infinite loop)
   d. SID+PIN still there after 60s wait → bridge hasn't restarted yet,
      sleep another minute and retry
```

Key design principles:
- **No operator interaction for routine reconnects** — only involve operator
  when there's a conflict (PIN rejected = someone else may be using it)
- **Timing signals intent** — if session persists after waiting, the bridge
  hasn't bounced yet
- **Fail-safe exits** — continuous rejection → exit, don't loop forever
- **Unauthenticated probe first** — check what's there before trying credentials

### Current Startup Flow (spawn.ps1)
```
Agent starts → session_start(reconnect: true) with saved SID/PIN
  → Operator gets approval dialog → clicks resume/wipe/exit
```

### Desired Startup Flow
```
Agent starts → probe list_sessions (no auth)
  → If SID exists: try PIN silently
    → Success: resume (no dialog)
    → Fail: ask operator about takeover
  → If SID gone: fresh session_start (no dialog needed)
```

## Bridge-Side Changes Needed

1. **Unauthenticated session probe** (see 10-198) — `list_sessions` must work
   without a PIN, returning only SIDs (no names, no details)
2. **Silent reconnect mode** — `session_start(reconnect: true)` should succeed
   without operator approval when the PIN matches and no one else is using it
3. **Conflict detection** — distinguish "PIN wrong" from "session taken by
   another client"

## Agent-Side Changes Needed

1. **Smart startup logic** in spawn.ps1 / startup sequence
2. **Retry with backoff** instead of immediate operator escalation
3. **Loop breaker** to prevent infinite reconnect attempts

## Design Decisions (Closed)

1. **Dormant TTL:** 30 minutes default, configurable via `mcp-config.json`.
   After TTL expires, session state is discarded and the SID is freed.
2. **Update buffering:** Yes — buffer up to 100 updates per dormant session.
   Prevents memory runaway while allowing reasonable catch-up.
3. **Identity continuity:** Yes — reconnected sessions keep the same SID.
   The SID is the agent's identity; changing it breaks references.
4. **Silent vs confirmed:** Silent reconnect when PIN matches AND no other
   client is actively using the session. Operator approval ONLY on conflict
   (another client has the session, or PIN doesn't match).
5. **Governor notification:** Yes — governor receives `session_reconnected`
   and `session_dormant` events via `dequeue_update`.

## Acceptance Criteria

- [ ] Formal reconnect protocol documented in agent guide
- [ ] `session_start(reconnect: true)` behavior well-defined and tested
- [ ] Dormant session state preserved for configurable TTL
- [ ] Missed updates delivered on reconnect (or gap notification sent)
- [ ] Governor notified of session state transitions
- [ ] Integration tested with bridge restart scenario

## Reversal Plan

Remove dormant session logic. Revert to current behavior where disconnect =
session destroyed.

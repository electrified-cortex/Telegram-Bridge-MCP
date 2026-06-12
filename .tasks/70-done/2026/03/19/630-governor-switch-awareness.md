# 630 — Governor Switch Awareness for Worker Sessions

**Priority:** 700 (Medium-High)  
**Source:** Operator request (voice, 2026-03-19) — routing audit

## Problem

When the governor session changes, worker sessions are not always notified. There are two code paths — one correct, one missing the notification:

| Path | Governor told? | Workers told? |
|---|---|---|
| `close_session` (governor closes naturally) | `governor_promoted` service message | ✅ Yes — `session_closed` with `new_governor_sid` |
| Health-check reroute (operator clicks "Reroute to X") | DM: "You are now the primary session" | ❌ **No notification** |

Workers receiving ambiguous messages from the operator need to know who the governor is. If the governor changes via the health-check panel and workers don't know, they have outdated assumptions about routing hierarchy.

## Root Cause

In `src/health-check.ts`, the operator callback after "Reroute to X" calls:
```typescript
setGovernorSid(targetSid);
deliverDirectMessage(0, targetSid, "↑ You are now the primary session...");
```

It does NOT loop over other active sessions to deliver a status update.

Compare with `close_session.ts` (lines ~83–95) which correctly loops:
```typescript
for (const s of remaining.slice(1)) {
  deliverServiceMessage(
    s.sid,
    `Session '...' has ended. '${label}' (SID ${next.sid}) is now the governor.`,
    "session_closed",
    { new_governor_sid: next.sid },
  );
}
```

## Fix

In `src/health-check.ts`, after calling `setGovernorSid(targetSid)` and notifying the new governor, also notify all other active sessions:

```typescript
const allSessions = listSessions();
for (const s of allSessions) {
  if (s.sid === targetSid) continue; // already notified
  deliverServiceMessage(
    s.sid,
    `Governor switched: '${targetName}' (SID ${targetSid}) is now the primary session.`,
    "governor_changed",
    { new_governor_sid: targetSid, new_governor_name: targetName },
  );
}
```

Use a new event type `"governor_changed"` (distinct from `"governor_promoted"` which is targeted at the new governor itself, and `"session_closed"` which implies a session ended).

## Acceptance Criteria

- [ ] When the operator clicks "Reroute to X" on the health-check panel, all other active sessions receive a `governor_changed` service message with `new_governor_sid` and `new_governor_name` in details.
- [ ] The new governor itself still receives its existing DM (unchanged).
- [ ] New event type `"governor_changed"` documented in `docs/inter-agent-communication.md` event table.
- [ ] Tests added for the health-check callback path: verify `deliverServiceMessage` called for non-target sessions with `"governor_changed"` event type.

## Related

- `src/health-check.ts` — where fix goes (callback handler)
- `src/tools/close_session.ts` — reference implementation (correct path)
- `src/session-queue.ts` — `deliverServiceMessage` function
- `docs/inter-agent-communication.md` — event type table to update
- Task 590 (governor command) — related context

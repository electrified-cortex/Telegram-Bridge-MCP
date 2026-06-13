# 10-733 - Closed sessions must reject their own reconnect tickets

## Context

Observed 2026-04-19 (msgs 38452-38453): after Curator closed Worker 1 (SID 3), the same OS process reconnected and came back as SID 7 via a fresh reconnect ticket that the operator approved. This defeats the purpose of closing a session - the zombie process acquired a new identity and kept running.

Operator ruling: a session that was closed (or force-closed) must not be able to grant its caller a new identity via reconnect. The close action must be terminal for that caller.

## Acceptance Criteria

1. When a session SID is closed (regardless of reason - operator, admin, force), record an anti-affinity marker for the **caller identity** (process fingerprint, token origin, or authenticated callsign) for a configurable TTL (default: session lifetime).
2. On subsequent reconnect / session-start attempts from the same caller identity, return an error ("This caller was closed in SID <X> - obtain a new approval ticket") instead of issuing a new session.
3. Operator approval is still required to override (explicit unblock action, e.g. `action(type: 'session/unblock', caller_id: ...)`).
4. Regression test: close a session, attempt reconnect with the same caller identity, assert rejection.

## Constraints

- Legitimate re-spawn (operator-initiated, new process) must not be blocked. Scope the anti-affinity to caller identity, not session name.
- "Caller identity" needs a concrete definition: session name alone is insufficient (name can be stolen); prefer process-level fingerprint or a token-origin hash.
- Changes to reconnect flow are security-sensitive - audit carefully.

## Priority

10 - bug, depth-4 (architecture). Zombie reconnect is a real security / fleet-hygiene issue.

## Delegation

Worker (TMCP) after design review. Curator should spec this before worker claims.

## Related

- Memory `feedback_session_close_vs_shutdown.md`.
- Memory `feedback_no_worker1_this_session.md` (the symptom we're treating).
- 10-732 (false back-online after close - adjacent close-path work).

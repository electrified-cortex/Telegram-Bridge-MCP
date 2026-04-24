# 10-732 - False "back online" after session/close

## Context

Observed 2026-04-19 (msgs 38373 + 38376): immediately after Curator called `session/close` on the Overseer, TMCP emitted a "session back online" service message for the just-closed SID. Operator confirmed: "bridge MCP detected [close] as activity and decided to say back online."

This is a real bug in the session presence tracker. Closing a session must NOT flag the session as online. The close event itself is being treated as liveness activity.

## Acceptance Criteria

1. Locate the presence/online-tracker in TMCP that flips sessions to "online" based on activity events.
2. Exclude `session/close` (and any other termination events like `shutdown_warn`, forced auth failure) from the activity set that triggers "online" state.
3. After `session/close` returns success, any subsequent "back online" emission for that SID must be suppressed unless the session actually re-opens (new `session/start` with new token).
4. Add a regression test: call `session/close` on a test session, assert no `back_online` event fires in the next 5 seconds.
5. `pnpm test` green.

## Constraints

- Do not change `session/close` return semantics.
- Do not silence legitimate back-online events after a real reconnect.
- The fix belongs in the event classifier / presence tracker, not in `session/close` itself.

## Priority

10 - bug. Observable, confusing, misleads operator into thinking kill-chain failed.

## Delegation

Worker (TMCP).

## Related

- Memory `feedback_session_close_vs_shutdown.md`.
- 10-720 (token-wipe hint on session/close - adjacent close-path work).

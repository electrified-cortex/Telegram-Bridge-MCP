# 10-732 - False "back online" after session/close

## Context

Observed 2026-04-19 (msgs 38373 + 38376): immediately after Curator called `session/close` on the Overseer, TMCP emitted a "session back online" service message for the just-closed SID. Operator confirmed (distilled): the bridge treated the close as activity and reported the session back online.

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

## Activity Log

- **2026-04-24** — Worker 3 (SID 5): Investigated root cause. The health-check recovery loop in `runHealthCheck()` treated a SID disappearing from `getUnhealthySessions()` as proof of recovery, even when the session had been closed. `getSession()` returning `undefined` (closed) vs the session object (alive) is the correct discriminator.
- **2026-04-24** — Implemented `!session` guard in `src/health-check.ts` recovery block: when `getSession(sid)` returns `undefined`, the session was closed (not recovered). Cleans up `_unresponsiveMsgIds`, `_backOnlineMsgIds`, and calls `clearOnceOnSend(sid)`. Skips back-online notification.
- **2026-04-24** — Added regression tests in `src/health-check.test.ts` under `describe("recovery detection — session closed before recovery")`: two new tests cover the closed-session guard path. Fixed 9 existing tests that needed `getSession.mockReturnValue(makeSession(...))` before recovery ticks due to the new guard. Resolved `mockResolvedValueOnce` queue bleed root cause (test 1 in "self-cleaning status messages" left unconsumed `99` because guard caused it to skip back-online send).
- **2026-04-24** — All 2484 tests passing. Committed `4170783` on branch `10-732`.

## Completion

Implementation complete. Committed `4170783` to worktree branch `10-732`.

- `src/health-check.ts`: `!session` guard in recovery loop suppresses false back-online for closed sessions; cleans up all tracking state.
- `src/health-check.test.ts`: 2 new regression tests + 9 fixed existing tests; 2484/2484 passing.

Ready for Overseer review.

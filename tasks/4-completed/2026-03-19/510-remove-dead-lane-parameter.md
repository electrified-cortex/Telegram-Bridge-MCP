# 510 — Remove dead _lane parameter from routeToSession

**Priority:** 510 (Low)
**Type:** Cleanup
**Status:** Backlog
**Created:** 2026-03-19
**Source:** PR #40 review thread `PRRT_kwDORVJb9c51W9et`

## Problem

`routeToSession(event, _lane)` in `session-queue.ts` accepts a `_lane?: "response" | "message"` parameter that is **never used**. This is a vestige from the TwoLaneQueue era — the function now routes purely based on event targeting and governor/broadcast logic.

The only call site passing this parameter is in `close_session.ts` L113:
```ts
routeToSession(event, event.event === "callback" ? "response" : "message");
```

## Code Path

- `src/session-queue.ts` L152: `export function routeToSession(event: TimelineEvent, _lane?: "response" | "message"): void`
- `src/tools/close_session.ts` L113: call site passing the dead parameter

## Fix

1. Remove the `_lane` parameter from `routeToSession`
2. Update the call site in `close_session.ts` to not pass it
3. Verify no other call sites pass it

## Acceptance Criteria

- [ ] `_lane` parameter removed from `routeToSession` signature
- [ ] All call sites updated
- [ ] TypeScript compiles cleanly
- [ ] All tests pass

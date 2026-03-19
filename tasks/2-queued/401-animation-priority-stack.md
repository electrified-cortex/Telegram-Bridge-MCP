# 310 — Animation Priority Stack

**Type:** Feature
**Priority:** 310 (Medium)
**Status:** Draft
**Created:** 2026-03-18

## Problem

Only one animation can run at a time. With multiple sessions, conflicts arise:

- Session 1 starts a persistent "working" animation
- Session 2 starts a temporary "thinking" animation
- When session 2's animation times out, session 1's should resume — but currently it's gone

There's no priority ordering. `show_animation` silently replaces whatever is running.

## Proposed Design

A **priority stack** for animations, similar to the reaction priority stack:

- Each session gets one animation slot on the stack (replacing their own previous entry)
- Each `show_animation` request includes an optional `priority` (higher number = higher precedence, default 0)
- The displayed animation is always the highest-priority active one (ties: latest wins)
- When an animation expires or is cancelled, the next-highest-priority active animation resumes
- Persistent animations stay on the stack until explicitly cancelled
- Temporary animations have timeouts and auto-remove from the stack
- If a new entry has a longer TTL than a buried one at the same priority, the buried one will never be shown — optimize that away

### Stack Behavior

```text
Animation stack (higher priority number = shown):
  [priority 5, temporary,  "thinking", session 2, timeout 60s]  ← displayed
  [priority 0, persistent, "working",  session 1]                (default priority)

Session 2's thinking times out →
  [priority 0, persistent, "working",  session 1]               ← resumes

Session 1 cancels →
  (empty) → no animation
```

### Priority Rules

- Default priority is 0 (like the baseline)
- Higher number = higher precedence (shown on top)
- Ties broken by recency (latest wins)
- Each session replaces its OWN entry when calling show_animation again
- Negative priorities are valid (always below default)

### Guard Opportunity

When a new animation request would NOT become the top of the stack (a higher-priority animation is already running), the server could:

- Still accept it (stack it silently)
- Return a warning indicating it's queued behind a higher-priority animation
- Configurable behavior

## Open Questions

- How does timeout work when an animation is stacked but not displayed? Does timeout tick while buried, or only while displayed?
- Maximum stack depth? (Bounded by active session count since each session gets one slot)
- Should `cancel_animation` cancel only the session's own animation, or can the governor cancel any?
- If a buried entry will never be shown (longer TTL entry above it at same priority), should it be pruned immediately?

## Edge Cases to Cover

- Same priority, different TTLs: longer TTL on top means shorter one will never surface
- Session replaces its own animation with a different priority
- Two persistent animations at different priorities — neither expires
- Cancel while buried (session cancels its entry that's not currently displayed)
- All temporary animations expire simultaneously
- Governor cancels another session's animation

## Code Path

- `src/animation-state.ts` — refactor from single-slot to priority stack
- `src/tools/show_animation.ts` — add `priority` parameter
- `src/tools/cancel_animation.ts` — handle stack removal vs full clear
- Tests for stack ordering, timeout while buried, resume after expiry

## Acceptance Criteria

- [ ] Design finalized (open questions resolved)
- [ ] Priority stack replaces single animation slot
- [ ] Highest-priority active animation is displayed
- [ ] Expiry/cancellation cascades to next in stack
- [ ] Empty stack means no animation
- [ ] Multi-session interleaving works correctly
- [ ] Timeout behavior for buried animations defined and implemented
- [ ] Tests cover all stack operations
- [ ] Build clean, lint clean, all tests pass
- [ ] `changelog/unreleased.md` updated

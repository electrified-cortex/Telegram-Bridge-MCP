# Reaction Priority Stack

**Type:** Feature
**Priority:** 450 (Normal — future)
**Status:** Draft
**Created:** 2026-03-18

## Problem

Multiple sessions may want to react to the same message simultaneously. Currently `temp-reaction.ts` supports one temporary reaction at a time — it sets a reaction and restores the previous one when done. But with multiple sessions:

- Session 2 sets a temporary 👀 on message X (priority 5)
- Session 3 sets a temporary ✍ on message X (priority 3)
- When session 3's reaction expires, what shows? Session 2's 👀? Or nothing?

There's no priority ordering, no stack. Last-write-wins.

## Proposed Design

A **priority stack** per message for reactions:

- Each reaction request includes an optional `priority` (higher number = higher precedence, default 0)
- The displayed reaction is always the highest-priority active one (ties: latest wins)
- When a reaction expires or is removed, the next-highest-priority active reaction is shown
- When the stack is empty (all temporary reactions expired), the original reaction (or nothing) is restored
- Persistent reactions have infinite duration; temporary ones have timeouts

### Stack Behavior

```text
Stack for message X:
  [priority 2, persistent, ✍, session 1]   ← shown (highest priority)
  [priority 5, temporary,  👀, session 2]
  [priority 8, temporary,  🫡, session 3]

Session 1 removes ✍ →
  [priority 5, temporary,  👀, session 2]   ← now shown
  [priority 8, temporary,  🫡, session 3]

Session 2's 👀 times out →
  [priority 8, temporary,  🫡, session 3]   ← now shown

Session 3's 🫡 times out →
  (empty) → restore original reaction or clear
```

## Open Questions

- Should priority values be session-global or per-request?
- How does this interact with the operator's own reactions (which come through Telegram directly)?
- Maximum stack depth? Guard against runaway accumulation?
- Does each session get a default priority, or must it be specified per call?

## Code Path

- `src/temp-reaction.ts` — refactor from single-reaction to priority stack per message
- `src/tools/set_reaction.ts` — add `priority` parameter
- Tests for stack ordering, expiry cascading, multi-session interleaving

## Acceptance Criteria

- [ ] Design finalized (open questions resolved)
- [ ] Priority stack per message ID
- [ ] Highest-priority active reaction is displayed
- [ ] Expiry cascades to next-highest
- [ ] Empty stack restores original
- [ ] Multi-session interleaving works correctly
- [ ] Tests cover all stack operations
- [ ] Build clean, lint clean, all tests pass
- [ ] `changelog/unreleased.md` updated

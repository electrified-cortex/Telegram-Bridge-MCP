---
id: 10-504
title: "Array-based reaction API for atomic layered reactions"
priority: 30
status: draft
created: 2026-04-12
tags: [feature, reactions, ux, api]
---

# Array-Based Reaction API

## Problem

Currently, setting layered reactions (permanent base + temporary overlays)
requires multiple successive `react` calls. This creates visible intermediate
states — the user sees reactions appear one at a time instead of a smooth
transition.

## Current API

```text
react(message_id, emoji: '👍')                        → call 1
react(message_id, emoji: '👀', temporary: true)       → call 2
```

Agent must make N calls for N layers. Each call produces a visible state
change. Flicker and intermediate states are unavoidable.

## Proposed API

Allow `react` to accept an array of reactions in a single call:

```text
react(message_id, reactions: [
  { emoji: '👍', priority: -1 },
  { emoji: '👀', priority: 0, temporary: true }
])
```

All reactions are applied atomically. The user sees the final state only
(highest-priority reaction visible, lower priorities queued for restore).

### Priority Convention

- **Negative numbers (-1):** Permanent base layer. Sits below everything.
  Never displaced unless explicitly targeted. Agents set this once.
- **Zero (0, default):** Standard temporary reactions. No priority needed —
  just set `temporary: true`. Same-priority temps replace each other.
- **Positive (1+):** Higher-priority overlays if needed (rare).

This minimizes agent cognitive load: "Set base at -1, everything else
is temporary with no priority needed."

## Use Cases

### Full engagement pattern (one call)

```text
react(message_id, reactions: [
  { emoji: '👍', priority: -1 },                  // permanent base
  { emoji: '👀', temporary: true }                 // "reviewing" (pri 0 default)
])
```

### Later transition (one call)

```text
react(message_id, reactions: [
  { emoji: '🤔', temporary: true }                 // replaces 👀 at pri 0
])
```

### On send — temps auto-clear, 👍 at -1 remains

## Backward Compatibility

Existing single-emoji `react` calls continue to work. Array form is
additive — agents can adopt incrementally.

## Discovery

Dogfooding session 2026-04-12. Operator proposed after observing
successive reaction calls producing visible flicker.

## Completion

**Date:** 2026-04-15
**Branch:** `10-504`
**Commit:** `a1f3eb7`

Added `reactions` array parameter to `react` tool in `src/tools/set_reaction.ts`. Array path is handled by `handleSetReactionArray` which validates all emoji up-front, applies permanent base via `recordBotReaction` (no extra Telegram API call), and sets the temp overlay via `setTempReaction`. Also includes the 10-503 same-priority temp restore fix (`temp-reaction.ts`).

Critical fixes applied during review: `recordBotReaction` moved after `setTempReaction` success check; `topItem` changed to `tempItems[0]`; empty array routed to error handler.

2231 tests pass.

- [x] Array form accepted by `react` tool
- [x] All reactions applied atomically
- [x] Backward compatible — existing single-emoji calls unchanged
- [x] Error on multiple temp items, empty array, invalid emoji
- [x] Tests cover the array path

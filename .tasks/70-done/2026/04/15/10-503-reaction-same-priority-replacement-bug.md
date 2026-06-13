---
id: 10-503
title: "Fix same-priority temporary reaction replacement"
priority: 30
status: draft
created: 2026-04-12
tags: [bug, reactions, ux]
---

# Fix Same-Priority Temporary Reaction Replacement

## Problem

When two temporary reactions are set at the same priority level, the second
should replace the first. Currently, the first reaction (e.g., 👀) persists
when the second (e.g., 🤔) is applied at the same priority.

## Observed Behavior

```text
react(msg, 👍, permanent, pri 0)   → 👍 shows ✓
react(msg, 👀, temporary, pri 1)   → 👀 shows ✓
react(msg, 🤔, temporary, pri 1)   → 🤔 shows, but 👀 still visible ✗
```

## Expected Behavior

```text
react(msg, 👍, permanent, pri 0)   → 👍 shows
react(msg, 👀, temporary, pri 1)   → 👀 shows (covers 👍)
react(msg, 🤔, temporary, pri 1)   → 🤔 replaces 👀 (covers 👍)
typing / send                       → temps clear, 👍 remains
```

Same-priority temporary reactions should replace, not stack.

## Discovery

Dogfooding session 2026-04-12. Curator practiced layering pattern on
operator's "Practice on this" message. Eyes persisted through thinking.

## Scope

Investigate `react` tool handler — check priority-level replacement logic
for temporary reactions at the same priority.

## Completion

- **Branch:** `10-503`
- **Commit:** `cbd687d`
- **Worktree:** `Telegram MCP/.worktrees/10-503`
- **Completed:** 2026-04-15

### Root Cause

In `src/temp-reaction.ts`, `setTempReaction` calls `_clearSlot(sid)` before reading `getBotReaction(messageId)`. By that point, `recordBotReaction` (called in `handleSetReaction` after each `setTempReaction`) had already recorded the intermediate temp emoji (👀) as the bot reaction. So the new slot's `restoreEmoji` was set to 👀 instead of 👍 (the original permanent).

### Fix

Capture `_slots.get(sid)` before `_clearSlot`. When replacing a temp on the same `messageId`, use the outgoing slot's `restoreEmoji` as `previousEmoji` — preserving the correct restore chain back to the original stable reaction.

**Files changed (2):**
- `src/temp-reaction.ts` — 5-line fix + comment
- `src/temp-reaction.test.ts` — 2 new regression tests

Build passes, 2221 tests pass (109 files).

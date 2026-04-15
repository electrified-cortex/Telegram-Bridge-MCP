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

```
react(msg, 👍, permanent, pri 0)   → 👍 shows ✓
react(msg, 👀, temporary, pri 1)   → 👀 shows ✓
react(msg, 🤔, temporary, pri 1)   → 🤔 shows, but 👀 still visible ✗
```

## Expected Behavior

```
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

---
name: animation-signaling-protocol
description: >-
  Animation and state signaling protocol for Telegram bridge MCP agents.
  Use when an agent needs to show its current activity state to the operator
  via Telegram animations.
---

# Animation Signaling Protocol

Animations tell the operator what you're doing. A silent agent looks like
a hung process. The operator must always be able to see your state.

## Presets

Animation presets are loaded from the agent's profile. Use them via
`send(type: "animation", preset: "...")`:

| Preset | When to Use |
| --- | --- |
| `thinking` | Before reading files, planning, researching |
| `working` | Before writing files, running commands, dispatching subagents |
| `reviewing` | Before reviewing diffs, reading subagent reports |
| `waiting` | When blocked on operator input or external events |

## Rules

1. **Show an animation before every significant action** — reading files,
   searching, writing tasks, dispatching agents.

2. **Use `persistent: true` for long operations.** Cancel when done with
   `action(type: "animation/cancel")`.

3. **Never go silent** for more than a few seconds without an animation.

4. **No animations when idle.** Silence is the correct signal that nothing
   requires attention. Only show animations when actively working.

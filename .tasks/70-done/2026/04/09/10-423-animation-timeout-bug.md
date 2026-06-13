---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 10-423
Source: Dogfood test 10-404, row 23
---

# Animation timeout not stopping animation

## Objective

Fix the animation timeout mechanism. When `timeout` is specified on animation
show, the animation should auto-cancel after the specified number of seconds.
Currently it persists indefinitely regardless of timeout value.

## Context

Dogfood row 23: `send(type: "animation", preset: "working", timeout: 5)` — animation
continued past 5 seconds. Operator confirmed: "Real bug."

## Acceptance Criteria

- [ ] Animation auto-cancels after the specified timeout
- [ ] If `persistent: true` and `timeout` are both set, timeout wins
- [ ] Test: start animation with `timeout: 5`, confirm it stops within 6 seconds

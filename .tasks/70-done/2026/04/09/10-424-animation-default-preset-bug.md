---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 10-424
Source: Dogfood test 10-404, row 32
---

# Set default animation by preset name not wired

## Objective

Fix `animation/default` action to accept a preset name and set it as the default
animation. Currently `name` and `preset` params are accepted without error but
the default frames remain unchanged.

## Context

Dogfood row 32: `action(type: "animation/default", preset: "working")` returns
the current default frames and available presets list, but doesn't update the
default to the "working" preset's frames.

Setting by `frames` array (row 31) and `reset: true` (row 33) both work
correctly. Only the preset-by-name path is broken.

## Acceptance Criteria

- [ ] `action(type: "animation/default", preset: "working")` sets default to working frames
- [ ] Response indicates the default was changed (not just a read)
- [ ] `action(type: "animation/default")` without mutating params returns current state (read mode)
- [ ] Test: set preset, start animation, verify it uses the preset's frames

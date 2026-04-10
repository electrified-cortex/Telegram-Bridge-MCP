---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 10-445
Source: Operator — observed Worker 2 assigned green instead of requested yellow
---

# Approve action should respect agent's requested color

## Objective

When `approve_agent` is called without an explicit `color` parameter, it should
use the agent's `colorHint` (the color they requested in `session/start`)
directly — not the "first available unused color." The current `getAvailableColors`
logic demotes the hint if that color is already in use by another session, causing
agents to get unexpected colors.

## Context

Workers request `color: "🟨"` (yellow) in their `session/start` call. When the
governor approves programmatically via `action(type: "approve", target_name: "Worker 2")`
without passing a color, the fallback calls `getAvailableColors(colorHint)[0]`.
If another session already has yellow, the function demotes yellow below unused
colors, so the Worker gets green (or whatever is first unused) instead.

The operator button approval works differently — buttons show all colors with the
hint first, and the operator can pick yellow even if it's in use. But programmatic
approval penalizes duplicate colors, which is inconsistent.

**Operator directive:** "It's not supposed to demote it. It's supposed to accept the
color requested."

**Further clarification (2026-04-10):** The color rotation is an independent list
in near-rainbow order. When a color gets used, it moves to the end. This rotation
exists to *suggest* a default when no specific color was requested — it helps the
operator pick the next useful color from buttons. But `colorHint` and the rotation
are independent:

- **Button approval:** The agent's `colorHint` is shown as the *primary* (first)
  button, signaling "this is what I want." Operator clicks it. Rotation order only
  matters for the other color options shown.
- **Programmatic approval** (governor calls `approve` without `color`): Should also
  default to `colorHint` — matching what the buttons would have shown as primary.

Currently, programmatic approval uses `getAvailableColors(colorHint)[0]`, which
reorders based on what's in use, potentially demoting the hint. This is wrong —
the rotation should NOT gate programmatic approval. Fix before release.

## Acceptance Criteria

- [ ] `approve_agent` without `color` param uses `colorHint` directly (not filtered through availability)
- [ ] Multiple agents can have the same color (no demotion of in-use colors for programmatic approval)
- [ ] Button-based approval unchanged (operator still sees all colors)
- [ ] Existing tests updated to reflect new behavior
- [ ] New test: two Workers both request yellow → both get yellow when approved without explicit color

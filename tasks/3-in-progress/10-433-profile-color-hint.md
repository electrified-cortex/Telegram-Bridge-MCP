---
id: 10-433
title: Profile color_hint — retroactive color correction on profile/load
type: bug
priority: medium
repo: Telegram MCP
branch: 10-433
source: Operator (live testing — Worker came online as green instead of yellow)
---

# 10-433: Profile color_hint

## Problem

When a Worker session starts without passing `color: "🟨"` in `session_start`, the
bridge assigns the first available LRU color (green, since blue is taken by Curator).
The operator must manually select yellow in the approval dialog.

Root cause: the Worker profile has no `color_hint` field, and `applyProfile` has no
mechanism to retroactively correct the color after `session_start`.

## Fix

- Add `color_hint?: string` to `ProfileData`
- Add `setSessionColor(sid, color)` to `session-manager.ts` (only applies if color is
  not currently held by a different active session)
- Wire `color_hint` in `applyProfile` — calls `setSessionColor`
- Add `"color_hint"` to `Worker.json` (🟨), `Curator.json` (🟦), `Overseer.json` (🟦)

## Acceptance Criteria

- [ ] `profile/load` with a profile containing `color_hint` updates the session color
- [ ] Color hint is not applied if another active session holds that color
- [ ] Current color is preserved if hint is already correct
- [ ] `Worker.json`, `Curator.json`, `Overseer.json` all have `color_hint`
- [ ] Tests cover: hint applied, hint blocked by conflict, hint already correct

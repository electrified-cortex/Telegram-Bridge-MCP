---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 35-441
Source: Operator
---

# Custom Name Tag Emoji

## Objective

Allow sessions to customize the robot emoji (🤖) in their name tag. Currently the name tag renders as `[color_square] [🤖] [session_name]` (e.g. "🟦 🤖 Curator"). The operator wants the ability to change the robot emoji to a different one (e.g. ⚙️, 🧠, ⚡, or a custom worker icon) per session.

## Context

- Name tags currently render as `[color_square] [robot_emoji] [session_name]`.
- The color square is already customizable. The robot emoji is hardcoded.
- The operator wants a session-level setting to replace the robot emoji with a custom one.
- This could be set at session start, via profile, or via a session command.
- The robot emoji is great as a default — this is about allowing personalization.

## Acceptance Criteria

- [ ] Sessions can specify a custom emoji to replace the robot emoji in their name tag
- [ ] Custom emoji replaces only the robot emoji; color square remains unchanged
- [ ] Setting is saveable via profile (persists across sessions)
- [ ] Falls back to robot emoji (🤖) if no custom emoji is set
- [ ] Existing tests pass

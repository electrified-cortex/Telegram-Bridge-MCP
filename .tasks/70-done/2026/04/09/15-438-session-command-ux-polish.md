---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 15-438
Source: Operator testing session
---

# /session Command UX Polish

## Objective

The `/session` command menu works well structurally but has several polish issues: Unix timestamps, confusing button for the current primary session, and suboptimal icons. Fix these for a cleaner operator experience.

## Context

Operator feedback from testing:
1. **Timestamps:** "Started" field shows raw Unix epoch — should be human-readable (e.g. "2 min ago" or "HH:MM").
2. **Primary button on active session:** The current primary/governor session shows a "Set as Primary" button for itself — pointless. Should either be hidden or show as an info label (not clickable).
3. **Icons:** Star (⭐) for primary and trash (🗑) for close aren't ideal. Consider alternatives. Not blocking, but noted.
4. **"This is the current primary session"** shows as a button — should be informational text, not a clickable element.

## Acceptance Criteria

- [ ] Session "started" time shows human-readable relative time or HH:MM format
- [ ] "Set as Primary" button is hidden (or disabled) for the session that is already primary
- [ ] "This is the current primary session" is shown as text/info, not as a clickable button
- [ ] Existing tests pass

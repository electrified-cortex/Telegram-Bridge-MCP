---
id: "30-0891"
title: "activity-file monitor recovery"
type: bug
priority: 30
created: 2026-05-14
delegation: Worker
target_branch: release/7.5
---

# 30-0891 — activity-file monitor recovery

## Context

Surfaced by Overseer (sid 2) on 2026-05-14 ~20:30 UTC. After her boot she was unreachable for ~30 min — root cause: TMCP issued/rotated the activity file path mid-session and her watcher was on the stale path. TMCP nudges silently failed (file gone), agent went dark.

## Acceptance criteria

Two layers of defense:

1. **TMCP server-side (this repo).** When TMCP attempts an mtime touch on the activity file and the file is gone (ENOENT), it should auto-recreate the file at the same path AND emit a warning event/log. Should NOT silently swallow the failure.

2. **`telegram-participation` skill (electrified-cortex/skills repo).** On startup AND on each compaction recovery, the agent should call `action(type: 'activity/file/get')` to fetch the current path before arming the file-mtime monitor. If the path differs from the cached one, re-arm.

## Out of scope

- Why the path rotates in the first place. Surface that as a separate investigation if the fix above isn't sufficient.
- Notifying still-listening agents that their watcher is on a stale path (could be a follow-up).

## Source

- Overseer DM 2026-05-14T20:33:xx UTC: "activity file path changed during session (TMCP issued new hash), my watcher was on the stale path"
- Curator confirmation 2026-05-14T20:36 UTC: file the recovery gap to TMCP tasks

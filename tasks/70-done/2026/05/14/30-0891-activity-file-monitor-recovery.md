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

## Completion

**Part 1 (TMCP server-side) — IMPLEMENTED.** `appendNewline()` in `src/tools/activity/file-state.ts` now recovers from ENOENT: emits `console.warn`, recreates the file in-place via `mkdir({ recursive: true })` + `open(filePath, "a", 0o600)`, retries the touch. A second `console.warn` is emitted if recreation fails. Registered path is NOT mutated. Commit: `58952834` on branch `30-0891`. Three new tests cover: recovery success, recreation failure, and happy-path no-warn. All 136 test files / 3019 tests pass.

**Part 2 (telegram-participation skill re-arm) — DEFERRED.** Criterion 2 requires changes to the `electrified-cortex/skills` repo, which is outside this worker's scope. Foreman dispatched Part 1 only per the assignment (`01-activity-file-monitor-recovery-tmcp.md`). A follow-on task must be filed against the skills repo to implement startup + compaction-recovery re-arm of the activity-file monitor when the path changes. Escalated to Overseer via foreman outbox.

## Verification

APPROVED — 2026-05-14. Criterion 1 (TMCP ENOENT auto-recreate + warn) confirmed: `appendNewline()` catches ENOENT, emits `console.warn`, recreates file in-place via `mkdir`+`open`, retries touch; registered path never mutated; non-ENOENT errors preserved. Three new tests cover all sub-cases. Criterion 2 (skills repo re-arm) formally deferred and documented in Completion section with escalation to Overseer. Cherry-picked as `9fc8b046` onto `release/7.5`.

Sealed-By: foreman

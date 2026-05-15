---
id: "30-1930"
title: "TMCP must delete activity files on session close + on full TMCP shutdown"
type: bug
priority: 30
created: 2026-05-15
delegation: Worker
target_branch: dev
---

# 30-1930 — activity-file cleanup on session close + TMCP shutdown

## Context

The new `file-watching` skill (`electrified-cortex/skills/file-watching/`) ships with **delete-as-shutdown** as the canonical off-ramp: if the watched file is deleted while running, the watcher emits `gone` and exits 0 cleanly — no process-killing required.

This composes elegantly with TMCP's per-session activity files (`data/activity/<hash>`): when a session closes, TMCP should delete its activity file. The agent's file-watching skill watching that file then cleanly unravels itself. No orphan watcher processes.

Operator believes this contract may already be partially implemented but it has never been formally verified. Same gap on TMCP full shutdown — all open activity files should be removed so any agent watchers cleanly exit.

## Acceptance criteria

1. **On session close** (`session/close` action, or any other path that terminates a session) — TMCP deletes that session's activity file from `data/activity/`. Confirmed by:
   - Sending `session/close` for a session with a registered activity file.
   - Verifying the file at the registered path is gone within 1 second.
   - Verifying any agent watcher on that file emits `gone` and exits 0.
2. **On TMCP shutdown** (`shutdown` action, process SIGTERM, normal process exit) — TMCP deletes ALL currently-tracked activity files. Confirmed by:
   - Listing `data/activity/` before shutdown (multiple files present).
   - Initiating shutdown.
   - Verifying `data/activity/` is empty (or contains only files for sessions whose owners declined deletion — see Out of scope).
3. If contract is already implemented, write the verification harness (an integration test) and ship that as the artifact. If not implemented, ship both the implementation and the test.
4. Document the contract in `help('shutdown')` and `help('session')` so agents know the cleanup happens automatically.

## Out of scope

- Cleaning up activity files for sessions whose owner explicitly opted out of cleanup (if such an opt-out exists; if not, no action — assume default-cleanup-on-close).
- Stale-file cleanup for activity files whose sessions died uncleanly (separate janitorial concern).

## Source

- Operator request 2026-05-15: "verification task for Telegram MCP that if any session is closed, it has to delete any relevant activity files. That should have already been true, but we need to have a verification of it. Including with that one, needs to verify that if the Telegram MCP is shut down, it also should remove any activity files."
- Triggered by: file-watching skill's delete-as-shutdown idiom enabling clean composability with TMCP's activity-file lifecycle.
- Pairs with: file-watching skill at `electrified-cortex/skills/file-watching/` (just shipped 2026-05-15).

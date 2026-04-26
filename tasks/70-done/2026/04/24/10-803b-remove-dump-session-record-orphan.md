---
id: 10-803b
title: Remove dump_session_record.ts orphan
status: queued
priority: 10
origin: task 40-475 reconciliation (2026-04-24)
---

# Remove dump_session_record.ts Orphan

## Context

Task 10-361 (remove-session-record-feature) was completed and the branch
deleted, but the branch was never merged to dev. PR #126 modified
`dump_session_record.ts` and its test instead of deleting them. As a result,
`src/tools/dump_session_record.ts` and `src/tools/dump_session_record.test.ts`
still exist on dev.

Decision: remove these files post-v6 (Curator, 2026-04-24).

## Acceptance Criteria

- [ ] `src/tools/dump_session_record.ts` deleted
- [ ] `src/tools/dump_session_record.test.ts` deleted
- [ ] Any imports/registrations of `dump_session_record` removed from `server.ts` and any other file
- [ ] Build and all tests pass
- [ ] `help.ts` TOOL_INDEX entry for `dump_session_record` removed

## Reversal

Git revert is sufficient — no schema or API surface change.

## Activity Log

- **2026-04-24** — Pipeline started. Variant: Implement only.
- **2026-04-24** — [Stage 4] Task Runner dispatched ×1. 5 files deleted/modified. Pre-existing lint errors in tool-hooks.ts and session_status.ts also fixed.
- **2026-04-24** — [Stage 5] Verification: diff non-empty, build PASS, 2629 tests PASS, lint PASS.
- **2026-04-24** — [Stage 6] Code Reviewer ×2: stale JSDoc comments fixed after pass 1 finding; pass 2 clean.
- **2026-04-24** — [Stage 7] Complete. Branch: 10-803b, commit: 8d42176.

## Completion

Deleted `src/tools/dump_session_record.ts` and its test. Removed TOOL_INDEX entry from `help.ts`, mock stubs from `action.test.ts` and `error-guidance.test.ts`, and stale JSDoc references in `debug-log.ts`, `message-store.ts`, `session-recording.ts`. Fixed two pre-existing lint errors. Build, lint, 2629 tests all pass.

Subagent passes: Task Runner ×1, Code Reviewer ×2. Final: 0 critical, 0 major, 0 minor.

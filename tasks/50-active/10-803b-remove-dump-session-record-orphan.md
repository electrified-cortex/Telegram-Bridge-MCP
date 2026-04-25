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

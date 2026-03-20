# Task #023 — Remove Status Fields from Task Documents

| Field    | Value                          |
| -------- | ------------------------------ |
| Priority | 5 (housekeeping)               |
| Created  | 2026-03-19                     |

## Goal

Folder location is the authoritative status for all task files. No task document should contain a `Status` field — it creates drift and confusion.

## Scope

Remove the `| Status | ... |` row from the header table in the following files:

- `tasks/1-draft/20-018-first-session-announcement.md`
- `tasks/1-draft/20-022-pin-session-announcement.md`
- `tasks/1-draft/30-020-proactive-rate-limiting.md`
- `tasks/1-draft/40-021-doc-audit.md`

Check `tasks/0-icebox/` and `tasks/2-queued/` for any Status fields as well (currently none found).

## Notes

- Do not add Status fields to any new task documents.
- No worktree needed — main workspace edits, single commit.
- No PR needed — merge directly to `v4-multi-session`.

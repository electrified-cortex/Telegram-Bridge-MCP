---
Created: 2026-05-27
Status: queued
Priority: low
Source: 2026-05-27 refactor scan
---

# Remove `_retired/edit_message_text.ts` from registry

## Problem

`src/tools/_retired/edit_message_text.ts` is a deprecated v2 tool (73 lines) still registered in `action.ts`. It is superseded by `edit_message`. It adds maintenance surface for no benefit.

## Action

1. Remove the import and registration entry from `src/tools/action.ts`.
2. Delete or archive `src/tools/_retired/edit_message_text.ts`.
3. Verify no agent or test references `edit_message_text` directly.
4. Update `docs/help/` if any help topic references the old tool name.

## Acceptance Criteria

- [x] `edit_message_text` no longer appears in the registered tool list.
- [x] `_retired/` folder is empty or removed.
- [x] Tests pass.

## Verification

- **Verdict:** APPROVED
- **Date:** 2026-06-01
- **Verifier:** dispatched sub-agent (read-only)
- **Squash commit:** `aa61e14` on `dev`
- **Worker commit:** `261593fb` on `worker/20-2102-v8-remove-retired-edit-message-text`
- **Test evidence:** 3271/3271 tests pass (142 files), tsc clean
- **Notes:** action.ts was already clean; _retired/ folder fully removed including companion test file

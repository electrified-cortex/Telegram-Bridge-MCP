---
Created: 2026-04-16
Status: Queued
Target: telegram-mcp-bridge
---

# 10-581 — Copilot Review Round 2 Fixes

## Context

Second Copilot exhaustion run on PR #136. 4 new comments, all real issues — mostly stale docs from the instruction field removal (10-579).

## Issues

1. **src/tools/load_profile.ts:14** — Tool DESCRIPTION still claims response includes `instruction` field. Remove from description string.

2. **src/tools/load_profile.ts:60** — Reminder navigation hint appended unconditionally even when no reminders loaded. Make conditional on `reminders.length > 0`.

3. **docs/help/profile/load.md:21** — Docs still show `instruction` field in example and description. Remove.

4. **docs/help/start.md:5** — MD022 markdownlint violation: heading needs blank line after it.

## Acceptance Criteria

- [x] All 4 issues fixed
- [x] Build clean (doc-only change)

## Completion

- **Branch:** `10-581-copilot-round2-fixes`
- **Commit:** `bdc2ff6` — fix(docs): add blank lines after headings in start.md (MD022)
- **Notes:** Fixes 1–3 (instruction field in load_profile.ts description, conditional reminder hint, instruction field in load.md) were already applied on the dev branch. Only Fix 4 (MD022 heading blank lines in start.md) required changes.

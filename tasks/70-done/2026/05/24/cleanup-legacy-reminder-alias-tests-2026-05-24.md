---
id: cleanup-legacy-reminder-alias-tests
title: Delete legacy reminder alias test files superseded by tools/reminder/ suite
type: cleanup
delegation: Worker-claimable (Overseer dispatches)
stage: queued
created: 2026-05-24
target_repo: electrified-cortex/Telegram-Bridge-MCP
target_branch: dev
---

# cleanup — Remove legacy reminder alias test files

## Context

Three test files in `src/tools/` are legacy aliases for reminder operations that were reorganized under `src/tools/reminder/`. They duplicate coverage that already exists in the modern suite:

| Legacy file | Modern equivalent |
|---|---|
| `src/tools/enable_reminder.test.ts` | `src/tools/reminder/enable.test.ts` |
| `src/tools/disable_reminder.test.ts` | `src/tools/reminder/disable.test.ts` |
| `src/tools/sleep_reminder.test.ts` | `src/tools/reminder/sleep.test.ts` |

Each legacy file has 5–6 tests that are semantically identical to (or a strict subset of) the modern file's tests.

## What to change

Delete the three legacy files:

```
src/tools/enable_reminder.test.ts
src/tools/disable_reminder.test.ts
src/tools/sleep_reminder.test.ts
```

Do NOT modify the modern `/tools/reminder/` files.

## Pre-deletion check

Before deleting, confirm that the modern files cover all scenarios present in the legacy files:
- If any legacy test covers a case NOT in the modern file, migrate it first.
- If coverage is 100% duplicated, delete directly.

## Acceptance criteria

- AC1. The three legacy test files no longer exist.
- AC2. The modern `src/tools/reminder/enable.test.ts`, `disable.test.ts`, and `sleep.test.ts` files are unchanged.
- AC3. All remaining tests pass (`npm test` exits 0).
- AC4. No test coverage is lost — verify by checking that all scenarios in the legacy files exist in the modern files before deleting.

## Out of scope

- Any other legacy alias files.
- Changes to test logic in the modern suite.

## Overseer review

- **Reviewer:** Overseer
- **Date:** 2026-05-24
- **Verdict:** APPROVED
- **Review type:** light-scan (operator-requested cleanup from test audit)

**Checked:**
- Scope minimal — 3 file deletions with pre-check gate
- AC4 prevents accidental coverage loss
- No production code touched

**Not checked:**
- Exact line-by-line comparison of legacy vs modern files (worker must verify AC4 before deleting)

## Verification

- **Verdict:** APPROVED
- **Verifier:** task-verification dispatch sub-agent (standard tier)
- **Date:** 2026-05-24
- **Commit:** 8cf1c84 (squash of worker/cleanup-legacy-reminder-alias-tests-2026-05-24 @ 2fa38b2a)
- **Test gate:** 145 files / 3221 tests pass
- **ACs confirmed:** AC1 (files deleted), AC2 (modern suite unchanged), AC3 (tests pass), AC4 (no coverage lost — identical line counts and structure verified)
- **Sealed-By:** Foreman

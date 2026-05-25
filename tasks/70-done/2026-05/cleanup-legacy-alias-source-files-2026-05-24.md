---
id: cleanup-legacy-alias-source-files-2026-05-24
title: Delete legacy alias source files left behind by test cleanup
type: chore
priority: high
created: 2026-05-24
delegation: worker
---

# Delete legacy alias source files

## Background

Round-1 test cleanup (2026-05-24) deleted the *test* files for legacy reminder aliases, but the corresponding *source* files were not touched. They are unreachable dead code that still compile into `dist/`.

## Files to delete

1. `src/tools/disable_reminder.ts` — exact duplicate of `src/tools/reminder/disable.ts`
2. `src/tools/enable_reminder.ts` — exact duplicate of `src/tools/reminder/enable.ts`
3. `src/tools/sleep_reminder.ts` — exact duplicate of `src/tools/reminder/sleep.ts`
4. `src/tools/session_status.ts` — legacy stub identical to `src/tools/session/status.ts`; not imported anywhere in production code

## Acceptance criteria

- [x] AC1: All 4 files deleted from `src/tools/`
- [x] AC2: No import in `server.ts`, `index.ts`, or any other production file references these paths (verify with grep before and after)
- [x] AC3: `npm run build` passes with no errors
- [x] AC4: `npm test` passes (no test references the deleted paths)
- [x] AC5: Committed on a branch and ready for squash merge

## Notes

- Do NOT delete `src/tools/reminder/` — that's the canonical location
- Do NOT delete `src/tools/session/status.ts` — that's the canonical location
- This is mechanical deletion only; no logic changes

## Overseer review

Reviewer: Overseer  
Date: 2026-05-24  
Verdict: APPROVED  
Review type: light-scan  
Checked: scope clear and bounded, AC binary and testable, delegation correct (worker), no open questions  
Not checked: technical correctness of implementation (trivial deletion)

## Claimant

Foreman session. Worker session: 65731d10. Worktree: .foreman-pod/.worktrees/cleanup-legacy-alias-source-files-2026-05-24

## Verification

Verifier: foreman dispatch (sonnet-class)
Date: 2026-05-24
Verdict: APPROVED

All 5 ACs confirmed. Commit `a5a4983d`: 4 files deleted, 184 deletions, no production imports of removed paths, `npm run build` clean, 3203/3203 tests pass. Squash-merged to `dev` as `043c962`.

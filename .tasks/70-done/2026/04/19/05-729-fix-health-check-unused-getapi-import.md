# 05-729 - Fix lint: unused `getApi` import in health-check.ts

## Context

Pre-merge pnpm gate on dev (commit 912730a, 2026-04-19) found lint error:

```
src/health-check.ts:25:10  error  'getApi' is defined but never used
```

Introduced by 10-719's fix (commit 4e16183) which switched `sendGovernorPrompt` from `getApi()` to `getRawApi()` but didn't remove the now-unused `getApi` import. CI on PR #136 (v7 dev to master) is blocked on this.

## Acceptance Criteria

1. Open `src/health-check.ts`.
2. Remove the `getApi` import (line 25) or rename to `_getApi` if there's a reason to keep it. Pick removal unless you find a call site.
3. Run `pnpm lint`: zero errors.
4. Run `pnpm test`: still green (sanity; no new breakage).
5. Commit inside your worktree on branch `05-729`.

## Constraints

- No behavior changes. This is a strictly mechanical unused-import cleanup.
- Do not refactor the health-check module beyond this single-line fix.

## Priority

05 - blocker. Direct gate to v7 master merge.

## Delegation

Worker (TMCP). Curator stages, Overseer reviews, operator merges.

## Related

- 10-719 (the fix that introduced the unused import).
- 20-721 (v7 master merge readiness parent).

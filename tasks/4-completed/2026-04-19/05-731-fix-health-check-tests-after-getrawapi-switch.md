# 05-731 - Fix health-check.test.ts after getRawApi() switch

## Context

PR #136 (v7.0.0) CI is still red after 05-729 + 05-730 landed. 12 failures in `src/health-check.test.ts` were introduced by task 10-719's switch from `getApi()` to `getRawApi()` — the test mocks were not updated to match the new call site.

This is the third and final known CI blocker before v7.0.0 can merge to master.

## Acceptance Criteria

1. Update mocks in `src/health-check.test.ts` so the 12 failing cases pass against the `getRawApi()` call path introduced by 10-719.
2. Do not change the production code in `src/health-check.ts` — this is a test-only fix. If the failures reveal a real production bug, stop and file a separate task rather than papering over it.
3. `pnpm lint && pnpm test` green on dev.
4. `pnpm build` green.

## Constraints

- Minimal diff. Only touch mock setup / assertions relevant to the `getRawApi()` change.
- Do not re-introduce `getApi()` anywhere — the switch to `getRawApi()` was intentional.
- Keep existing test coverage: if a test is deleted rather than fixed, justify it in the PR description.

## Priority

05 - CI blocker on PR #136 (v7.0.0). Unblocks the master merge operator is holding on.

## Delegation

Worker (TMCP). Can be claimed immediately; workers 3 and 6 are idle.

## Related

- 10-719 (the `getRawApi()` switch that broke the tests).
- 05-729 (unused `getApi` import cleanup — same origin task).
- 05-730 (em-dash test fix — sibling PR #136 blocker).

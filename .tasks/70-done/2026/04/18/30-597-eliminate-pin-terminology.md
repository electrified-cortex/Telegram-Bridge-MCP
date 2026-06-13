# 20 — 597 — Eliminate PIN terminology from codebase

## Summary

The term "PIN" is a misnomer — it's just part of the token generation,
not a user-facing PIN concept. The operator wants all references to
"pin" renamed to use "token" or "auth token" terminology throughout
the codebase.

## Scope

308 occurrences across 77 files. Key areas:
- `session-manager.ts` (13 hits) — core session logic
- `session_start.ts` (10) — token generation
- `identity-schema.ts` (10) — schema definitions
- `session_start.test.ts` (96) — heaviest test file
- `startup-pin-cleanup.ts` (4) — file may need renaming
- `help.ts` (3) — user-facing help topics
- `service-messages.ts` — user-facing onboarding text

## Requirements

1. Rename `pin` variable/field names to appropriate alternatives
   (`tokenSuffix`, `authSuffix`, or just fold into `token` generation)
2. Rename `startup-pin-cleanup.ts` → `startup-token-cleanup.ts` or similar
3. Update all test files to match renamed variables
4. Update help topics and service messages — no user-facing "PIN"
5. Internal code comments explaining token generation are acceptable
6. The token formula `sid * 1_000_000 + pin` stays as implementation —
   just rename `pin` to something like `secret` or `suffix`

## Existing Work

W3 (SID 6) completed ~70 file renames in worktree
`.worktrees/20-597-eliminate-pin-terminology/` (branch
`20-597-eliminate-pin-terminology`). Changes are staged but NOT
committed. All tests passed. Resume from that worktree — don't
redo the work.

## Constraints

- This is a mechanical rename — no behavioral changes
- Must not break the token format (still `sid * 1_000_000 + suffix`)
- Tests must all pass after rename
- Standalone PR — do AFTER all other PRs merge (merge conflict risk)
- Consider doing this as a standalone PR for clean review

## Acceptance Criteria

- [ ] Zero user-facing references to "PIN"
- [ ] All variable/field renames consistent
- [ ] File renames where appropriate
- [ ] All tests pass
- [ ] No behavioral changes

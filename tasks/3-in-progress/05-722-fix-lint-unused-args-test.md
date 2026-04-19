# 05-722 - Fix lint: unused `args` parameter in unknown-param-warning tests

## Context

GPT-5.4 audit of v7 dev branch (2026-04-19). `pnpm lint` fails with 3 `@typescript-eslint/no-unused-vars` errors:

- `unknown-param-warning.test.ts:210` — `args` declared, never used
- `unknown-param-warning.test.ts:219` — same
- `unknown-param-warning.test.ts:229` — same

This is the **only blocker** to V7 → master merge. Build is green, all 2441 tests across 115 files pass; lint is the lone red flag.

## Acceptance Criteria

1. Open `unknown-param-warning.test.ts`, locate the three handler signatures at lines 210, 219, 229.
2. For each, either:
   - Rename `args` to `_args` (signals intentional unused), OR
   - Remove the parameter entirely if the handler signature allows.
3. Run `pnpm lint` → expect zero errors.
4. Run `pnpm test -- --runInBand` → still green (sanity).

## Constraints

- Don't change handler behavior — this is a lint-only fix.
- Pick one convention (`_args` vs removal) and apply consistently across all three sites.

## Priority

05 - blocker. V7 → master merge cannot proceed until lint is green.

## Related

- 20-721 (parent V7 merge readiness audit).

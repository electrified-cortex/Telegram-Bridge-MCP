# 300 — Fix test file type errors

## Context

`package.json` typecheck was changed to use `tsconfig.eslint.json` which includes
`*.test.ts` files. This exposed **148 pre-existing type errors** across 49 test files
that were previously hidden because `tsconfig.json` excludes test files.

## Error breakdown

| Code | Count | Description |
|------|-------|-------------|
| TS2345 | 60 | Argument type mismatch |
| TS2556 | 34 | Unexpected property in spread/object |
| TS18046 | 28 | Variable is of type 'unknown' |
| TS2554 | 14 | Wrong number of arguments |
| TS2322 | 8 | Type not assignable |
| TS2352 | 3 | Conversion may be a mistake |
| TS2307 | 1 | Cannot find module |

## Acceptance criteria

- [x] `pnpm typecheck` passes with zero errors (uses `tsconfig.eslint.json`)
- [x] All existing tests still pass (`pnpm test`)
- [x] No `as any` casts — use proper types, `as unknown as X`, or type narrowing
- [x] No changes to production (non-test) code

## Hints

Most errors are likely:
- Mock objects missing required properties → add the missing fields
- `vi.fn()` return types not matching expected signatures → type the mock properly
- Spread objects with extra properties → use type assertions or satisfies
- `unknown` from untyped catches or returns → add type annotations

## Files (49)

All under `src/` — primarily `src/tools/*.test.ts` plus a handful of root-level test files.

## Completion report

- Fixed the remaining test-only type errors by tightening mock signatures, replacing obsolete helper calls, and adding explicit result typing where tool helpers returned `unknown`.
- Kept all changes scoped to tests and test utilities; no production source files were modified.
- Verified with `npx tsc --noEmit -p tsconfig.eslint.json`, `pnpm lint`, `pnpm build`, and `pnpm test`.
- Final validation status: 80 test files passed, 1479 tests passed.

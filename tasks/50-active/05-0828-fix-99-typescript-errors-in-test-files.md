---
id: 05-0828
title: fix 99 TypeScript errors in test files (now blocking pnpm test)
priority: 5
status: draft
type: bug-fix
delegation: any
---

# Fix 99 TypeScript errors in test files

`pnpm test` now runs `tsc --noEmit -p tsconfig.eslint.json` before vitest. There are 99 pre-existing TypeScript errors across 25 test files that previously slipped through because each verify lane ignored test files in different ways. The gate is now real; the errors must be resolved.

## How it slipped through

- `tsconfig.json` excludes `**/*.test.ts` → `pnpm build` (`tsc`) never saw them.
- `eslint` rule set differs from raw `tsc` strict checks → `pnpm lint` passed despite real type errors.
- `vitest run` uses the esbuild loader, not strict tsc → tests executed and passed.
- `pnpm typecheck` script existed but was not in any verify lane.

The structural fix landed first (`pnpm test` now chains typecheck before vitest). Operator's call: "typecheck should always be present as part of pnpm test."

## Affected files (25)

- `src/async-send-queue.test.ts`
- `src/built-in-commands.test.ts`
- `src/hook-animation.integration.test.ts`
- `src/hook-animation.test.ts`
- `src/local-log.test.ts`
- `src/session-queue.test.ts`
- `src/shutdown.test.ts`
- `src/silence-detector.test.ts`
- `src/tool-hooks.test.ts`
- `src/tools/_retired/edit_message_text.test.ts`
- `src/tools/_retired/edit_message_text.ts`
- `src/tools/action.test.ts`
- `src/tools/approve/agent.test.ts`
- `src/tools/confirm/handler.test.ts`
- `src/tools/dequeue.test.ts`
- `src/tools/error-guidance.test.ts`
- `src/tools/message/route.test.ts`
- `src/tools/profile/apply.test.ts`
- `src/tools/profile/dequeue-default.test.ts`
- `src/tools/react/set.test.ts`
- `src/tools/reminder/list.test.ts`
- `src/tools/send.test.ts`
- `src/tools/send/choose.test.ts`
- `src/tools/session/idle.test.ts`
- `src/tools/session/start.test.ts`

## Common error categories

- TS2556: spread argument requires tuple type or rest parameter (likely vi.fn / mock signatures).
- TS2352: empty array `[]` cast to tuple type — missing test fixture data.
- TS2345: argument-type mismatch — usually `from: string` vs `from: "user" | "bot" | "system"` literal-union types.
- TS18046: variable typed `unknown` after destructuring — needs explicit narrow or assertion.
- TS2554: arity mismatch — function called with wrong number of args.
- TS2560: shape mismatch on `Express`-vs-`http.Server` (in `hook-animation.integration.test.ts`).

## Approach

Workers can split the file list by test file — each worker takes a subset, fixes the errors, runs `pnpm typecheck` until clean. No behavior changes — these are type-only adjustments to test code.

For `_retired/` files: lowest priority. Consider whether to delete the directory entirely if these tests no longer run; check Vitest config first.

## Acceptance criteria

- `pnpm typecheck` exits 0.
- `pnpm test` runs full vitest suite after typecheck passes.
- All 2762 existing tests still pass.
- No production code (`src/**/*.ts` non-test) modified except where test fixes uncover real type bugs in production code (rare; flag if it happens).

## Out of scope

- Rewriting tests for clarity. Type fixes only.
- Adding new tests.
- Removing `_retired/` files (separate cleanup task if anyone wants it).

## Pipeline impact

While this is open, **`pnpm test` will fail** in any worker checking out fresh code. Acceptable per operator: "should always be present." Workers should fix-as-they-go on whichever test files they touch in their primary task; this task absorbs the rest.

## Related

- `package.json` change committed alongside this draft.
- `tsconfig.eslint.json` is the project source of truth for what tsc checks.

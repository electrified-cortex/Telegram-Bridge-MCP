---
created: 2026-06-20
status: queued
priority: 5
source: Overseer audit — Phase 3/4 rich-message compiler work (10-3013/10-3014) left 25 ESLint errors on dev
repo: electrified-cortex/Telegram-Bridge-MCP
type: BugFix / Tech Debt
agent_type: Worker
model_class: sonnet-class
reasoning_effort: low
epic: 10-3002-v8-tech-debt-cleanup-epic
branch: dev
---

# 10-3027 — Lint Fix: Phase 3/4 Rich-Message Compiler ESLint Errors

## Problem

25 ESLint errors were introduced on `dev` by the Phase 3/4 rich-message compiler work
(tasks 10-3013 and 10-3014). `pnpm run lint` fails with exit code 1. CI is blocked.

All errors are mechanical and safe to fix: unnecessary type assertions, redundant null
checks, unused imports, and async-without-await function signatures.

## Errors (exact, from `pnpm run lint` on dev as of 2026-06-20)

### `src/rich-message-compiler.test.ts` (4 errors)
- 5:32 — `vi` is defined but never used (`@typescript-eslint/no-unused-vars`)
- 5:36 — `beforeEach` is defined but never used
- 5:48 — `afterEach` is defined but never used
- 429:25 — Unnecessary type assertion (`@typescript-eslint/no-unnecessary-type-assertion`)

### `src/rich-message-compiler.ts` (14 errors)
- 421:9, 528:15, 569:15, 612:27, 629:27, 662:29, 787:23, 800:23, 838:19 — Unnecessary type assertions
- 644:28, 677:20, 834:25, 837:18 — Unnecessary `??` conditionals (left-hand side is never null)

### `src/session-queue.ts` (1 error)
- 603:38 — Unnecessary optional chain on non-nullish value

### `src/telegram.test.ts` (3 errors)
- 833:7, 842:7, 856:7 — Async method `json` has no `await` expression (`@typescript-eslint/require-await`)

### `src/telegram.ts` (4 errors)
- 3:33 — `RichMessage` is defined but never used
- 698:24 — Forbidden non-null assertion (`@typescript-eslint/no-non-null-assertion`) — use optional chaining or null check
- 708:8, 728:8 — Async functions `updateRichMessageDraftDirect` / `finalizeRichMessageDraftDirect` have no `await` — remove `async` keyword

## Fix approach

For each error category:

1. **Unused imports** — remove from import statement. Verify no other usages in file.
2. **Unnecessary type assertions** (`x as T` where T is already the inferred type) — remove the `as T` cast.
3. **Unnecessary `??` conditionals** — if the linter says left-hand side is never null/undefined, remove the `?? fallback` guard. Verify by reading the type context.
4. **Async without await** — remove `async` keyword from function signature. Return type changes from `Promise<T>` to `T` — update callers if needed.
5. **Non-null assertion** at telegram.ts:698 — replace `!` with optional chaining (`?.`) or add an explicit null check with a clear error message.

> ⚠️ Do NOT blindly apply `--fix` to all errors. Use eslint --fix ONLY for the 10 fixable errors flagged by the linter, then manually fix the remaining 15. Manually verify each change does not alter runtime behavior.

## Scope

**Modifies:** `src/rich-message-compiler.test.ts`, `src/rich-message-compiler.ts`,
`src/session-queue.ts`, `src/telegram.test.ts`, `src/telegram.ts`

**Does not modify:** Any other source file. No behavior changes.

## Acceptance Criteria

- [ ] `pnpm run lint` exits 0 with no errors.
- [ ] `pnpm test` passes (all pre-existing tests still pass; no new failures).
- [ ] `tsc --noEmit` passes.
- [ ] Commit is directly to `dev` branch (TMCP exception — no PR required).
- [ ] Commit message: `fix(lint): remove Phase 3/4 rich-message compiler ESLint errors`

## Delegation

Executor: Worker (branch: dev directly) / Reviewer: Foreman

## Bailout

30 minutes. If removing `async` from `updateRichMessageDraftDirect` or `finalizeRichMessageDraftDirect` requires caller changes that touch more than 3 additional files, surface to Foreman before proceeding.

## Notes

- The 10 auto-fixable errors can be applied with `eslint --fix`, but run lint again afterward to confirm the count dropped correctly before committing.
- The `telegram.ts:698` non-null assertion needs a judgment call — read the surrounding context to choose between `?.` (silent) and an explicit throw (loud). Prefer the pattern already used in this file.
- These errors do NOT appear on branches other than dev (checked: same file content on all open branches).

## Overseer review

Reviewer: Overseer | Date: 2026-06-20 | Verdict: **PASS** | Type: Self-authored task gate

Checked:
- AC binary + testable: ✅ — lint/test/tsc are pass/fail; commit to dev is verifiable
- Scope bounded: ✅ — 5 files, 25 errors by line number, no behavior change
- Delegation correct: ✅ — Worker/Foreman, TMCP exception covers direct dev commit
- No critical open question: ✅ — non-null assertion has guidance; bailout defined
- Well-specced: ✅ — exact errors, fix approach per category, commit message specified

Not checked: Live run (Worker executes). Lint count verified against actual `pnpm lint` output.

## Verification

Reviewer: Foreman | Date: 2026-06-21 | Verdict: **APPROVED**

- AC1 — `pnpm run lint` exits 0: ✅ CONFIRMED — test-results.md records exit 0, 0 errors (was 25)
- AC2 — `pnpm test` passes: ✅ CONFIRMED — 3550/3552 pass; 2 pre-existing failures in service-messages.test.ts (unrelated, confirmed via stash round-trip)
- AC3 — `tsc --noEmit` passes: ✅ CONFIRMED — test-results.md records exit 0
- AC4 — commit on `dev`: ✅ CONFIRMED — operator fast-forwarded dev to 983d5f22
- AC5 — commit message: ✅ CONFIRMED — exact match `fix(lint): remove Phase 3/4 rich-message compiler ESLint errors`
- Test gate (4.5): ✅ PASS — test-results.md and test-plan.md both present with execution evidence

Sealed-By: Foreman | Commit: 983d5f22 | Branch merged: worker/10-3027-lint-fix → dev

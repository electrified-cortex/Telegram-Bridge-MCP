---
id: "30-2203"
Created: 2026-05-28
Updated: 2026-06-20
Status: queued
Priority: 10
Source: Curator reproduction; filed 2026-05-28
repo: electrified-cortex/Telegram-Bridge-MCP
type: Bug
agent_type: Worker
model_class: sonnet-class
reasoning_effort: low
branch: dev
---

# Bug: `checklist/update` action fails with undefined replace error

## Problem

`action(type: "checklist/update")` consistently fails with:

```
{"code":"UNKNOWN","message":"Cannot read properties of undefined (reading 'replace')"}
```

Reproduced 3x passing a full `steps` array with a valid `message_id`. Checklist creation via `send(type: "checklist")` works fine. Only the update path is broken.

## Root cause (identified 2026-06-20)

The `title` parameter was missing from the action call. TypeScript types on `handleUpdateChecklist` (`title: string`) don't prevent runtime `undefined` when called via the action dispatch path (which bypasses Zod schema validation).

Flow: `action(type: "checklist/update", message_id: X, steps: [...])` → no `title` → `handleUpdateChecklist({ title: undefined, ... })` → `renderStatus(applyTopicToTitle(undefined), steps)` → `escapeHtml(undefined)` → `undefined.replace(...)` → crash.

The `.replace()` call is in `src/markdown.ts:37` (`escapeHtml`), not in `update.ts` — the prior bounce correctly identified no `.replace()` in `update.ts`, but missed the `escapeHtml` dependency.

## Fix

Add a runtime guard at the top of `handleUpdateChecklist` to validate `title` is present and is a string before any processing. Return `toError` with a clear message if missing.

**Suggested guard** (add after `const chatId = resolveChat()` check):
```ts
if (typeof title !== "string") {
  return toError({ code: "MISSING_REQUIRED_FIELD", message: "title is required for checklist/update" });
}
```

## Acceptance Criteria

- [ ] Root cause: `typeof title !== "string"` guard added in `handleUpdateChecklist` before any string operations.
- [ ] `action(type: "checklist/update", message_id: <id>, steps: [...])` (no title) returns a clear `MISSING_REQUIRED_FIELD` error instead of crashing.
- [ ] `action(type: "checklist/update", title: "...", message_id: <id>, steps: [...])` updates the checklist without error.
- [ ] Test added: `handleUpdateChecklist` called with `title: undefined` → verify MISSING_REQUIRED_FIELD returned (not a throw).
- [ ] No regression on checklist creation path.

## Delegation

Worker — single guard + test, no architectural decisions.

## Overseer bounce (2026-06-01)

- reviewer: Overseer SID-3
- verdict: REJECT — spec needs investigation before execution
- finding: Adversarial check found `update.ts` contains NO `.replace()` call anywhere in its code path. String operations are only `renderStatus`, `escapeHtml`, and `applyTopicToTitle`. Error origin is likely in one of these dependencies OR in the Telegram API wrapper. Also: repro description missing `title` field (required parameter) — its absence may be the actual trigger.
- action: Curator to investigate actual `.replace()` call site (check `applyTopicToTitle`, `escapeHtml`, or upstream Telegram wrapper). Update AC1 with correct root cause location. Also verify repro includes `title` field.

## Overseer review (2026-06-20)
- reviewer: Overseer
- date: 2026-06-20
- verdict: PASS
- review type: re-gate after investigation
- checked: Root cause confirmed (`escapeHtml(undefined)` in `markdown.ts:37`) ✓, fix surgical ✓, AC binary+testable ✓, delegation correct ✓, scope bounded ✓
- not checked: runtime (worker validates via pnpm test)

## Verification

Reviewer: Foreman | Date: 2026-06-21 | Verdict: **APPROVED**

- AC1 — `typeof title !== "string"` guard in `handleUpdateChecklist`: ✅ CONFIRMED — `update.ts:132-134`, placed before `renderStatus(applyTopicToTitle(title), steps)`
- AC2 — No-title call returns MISSING_REQUIRED_FIELD: ✅ CONFIRMED — guard returns `toError({ code: "MISSING_REQUIRED_FIELD", ... })` before any string op
- AC3 — Valid title call unaffected: ✅ CONFIRMED — guard is additive; 32 existing tests pass unchanged
- AC4 — Test for undefined title: ✅ CONFIRMED — `update.test.ts:348-352`, direct call bypassing Zod, asserts `isError` + `errorCode === "MISSING_REQUIRED_FIELD"`
- AC5 — No regression on checklist creation: ✅ CONFIRMED — 33/33 tests pass in update.test.ts
- Test gate (4.5): ✅ PASS — test-plan.md and test-results.md both present with execution evidence

Sealed-By: Foreman | Commit: 1f6f1a62 | Branch merged: worker/30-2203-checklist-fix → dev

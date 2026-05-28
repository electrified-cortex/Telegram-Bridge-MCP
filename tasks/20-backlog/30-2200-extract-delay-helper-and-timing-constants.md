---
Created: 2026-05-05
Status: backlog
Priority: low
Source: operator voice 2026-05-05 msg 50376
---

# Extract `delay(ms)` async helper and timing constants

## Problem

Two related code-quality issues found throughout TMCP source:

1. The pattern `await new Promise(resolve => setTimeout(resolve, ms))` is repeated inline across `src/` and tests with no shared helper.
2. Magic timing values (e.g. `300_000` for long-poll timeout, `30_000` for debounce) appear as bare numbers with no named constants, making the codebase hard to audit and adjust.

Operator quote: "That should be a function that's so simple. Why doesn't there just a delay-async or something like that and move on. It's so replicated. And then I would say that allow it to be configurable."

## Acceptance Criteria

- [ ] `delay(ms: number): Promise<void>` exported from a shared helper module (e.g. `src/utils/timing.ts`).
- [ ] Every inline `new Promise(resolve => setTimeout(resolve, ms))` in `src/` replaced with `delay(ms)`.
- [ ] Test files updated to use `delay(ms)`.
- [ ] Magic timing values >100 ms in non-test code use named constants.
- [ ] If extracted constants reveal disagreements between modules on what a value should be, surface as a separate finding — do not silently unify.
- [ ] All existing tests pass (no behavioral change).

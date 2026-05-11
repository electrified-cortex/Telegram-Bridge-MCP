---
title: "Extract `delay(ms)` async helper + timing constants"
type: refactor
priority: 50
status: idea
created: 2026-05-05
filed-by: Curator
target_repo: telegram-bridge-mcp
---

# Extract `delay()` helper + timing constants

## Operator framing (2026-05-05, msg 50376)

> "I'm seeing a lot of the, you know, set timeout, delay, promise, whatever. To be honest, that should be a function that's so simple. Why doesn't there just a delay-async or something like that and move on. It's so replicated. And then I would say that allow it to be configurable. So we're doing things like, sure, for the tests it says like 300 seconds, but do we have a constant? Or just use constants sometimes too. It's a little bit concerning that we don't have constants."

## Concept

Two concerns bundled:

### A. Extract `delay(ms)` helper

Replace the repeated `await new Promise(resolve => setTimeout(resolve, ms))` (or similar) inline pattern with a single shared helper:

```ts
export const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));
```

Or however the codebase prefers. Update every site that uses the inline pattern.

### B. Magic timing values become constants

Magic numbers in test/source code (e.g., `300_000` for 5-minute timeouts, `30_000` for 30-second debounces) become named constants. Either in a shared `timing.ts` module or per-feature alongside the code that owns them.

Examples to look for:
- Long-poll defaults (300 s)
- Activity-file kick debounce (varies)
- TTS render timeouts
- Compaction-recovery animation cleanup

## Goal (next version, post-7.4)

Survey all `setTimeout`-based delays in `src/` + `tests/`. Extract to `delay()` helper + named constants.

## Acceptance criteria

- `delay(ms)` exported from a shared helper module (e.g., `src/utils/timing.ts` or wherever fits the existing structure).
- Every inline `new Promise(resolve => setTimeout(resolve, ms))` in `src/` and tests replaced with `delay(ms)`.
- Magic timing values >100 ms in non-test code use named constants.
- Tests still pass (no behavioral change).

## Out of scope

- Reworking the underlying timing mechanisms (debounce, throttle).
- New timing features.

## Bailout

- If extracted constants reveal disagreements between modules on what a value SHOULD be, surface as a separate finding — don't silently unify.

## Priority

Backlog. Operator said "not urgent." Bundle with other naming/cleanup work post-7.4.

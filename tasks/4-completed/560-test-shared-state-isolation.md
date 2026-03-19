# 560 — openai-schema-compat.test.ts: isolate shared state

**PR Review Threads:** `PRRT_kwDORVJb9c51emM0`, `PRRT_kwDORVJb9c51emNE`

## Problem

`src/openai-schema-compat.test.ts` uses a module-level `captured: CapturedTool[]` array that accumulates entries across test runs. If test isolation isn't perfect, earlier tests can pollute later ones.

## Fix

Clear the `captured` array in a `beforeEach` or `beforeAll` hook so each test (or test suite run) starts fresh.

```ts
beforeEach(() => {
  captured.length = 0;
});
```

Or move `captured` inside the describe block if feasible.

## Acceptance

- `captured` is reset between tests.
- All existing tests pass.

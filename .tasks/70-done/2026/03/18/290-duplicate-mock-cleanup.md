# Remove duplicate mock setup lines in test files

**Type:** Code quality
**Priority:** 290 (Low — cleanup)
**Source:** Copilot PR review #5 (2026-03-19)

## Problem

Several test files have duplicate `mocks.validateSession.mockReturnValue(true)` calls in their `beforeEach` blocks. These are harmless but noisy — copy/paste artifacts from the task 300 test refactor.

### Known instance

**`src/tools/send_chat_action.test.ts`** lines 31–32:

```typescript
beforeEach(() => {
  vi.clearAllMocks();
  mocks.validateSession.mockReturnValue(true);   // ← original
  mocks.validateSession.mockReturnValue(true);   // ← duplicate — remove
  const server = createMockServer();
```

### Likely pattern

Other test files in `src/tools/` may have the same duplicate. Search all `*.test.ts` files for consecutive identical `mockReturnValue` lines.

## Fix

1. Search: `grep -n "mockReturnValue(true)" src/tools/*.test.ts` to find all instances
2. Remove any line that is an exact duplicate of the line immediately above it
3. Do NOT remove non-consecutive duplicates (those may be intentional, e.g., in different `describe` blocks)

## Code Path

- `src/tools/send_chat_action.test.ts` — confirmed duplicate at lines 31–32
- `src/tools/*.test.ts` — scan all for the same pattern

## Acceptance Criteria

- [ ] No consecutive duplicate `mockReturnValue` lines remain in any test file
- [ ] Existing tests pass — `npx vitest run` (expect 1479 tests)
- [ ] Build clean — `npx tsc --noEmit`
- [ ] Lint clean — `npx eslint src/`

---
id: refactor-test-identity-gate-shared
title: Extract shared identity gate tests — eliminate ~300 redundant assertions across 41 files
type: refactor
delegation: Worker-claimable (Overseer dispatches)
stage: queued
created: 2026-05-24
target_repo: electrified-cortex/Telegram-Bridge-MCP
target_branch: dev
---

# refactor — Extract shared identity gate test helper

## Context

41 tool test files each contain a nested `describe("identity gate", ...)` block with 3 near-identical tests:

```typescript
describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => { ... });
  it("returns AUTH_FAILED when identity has wrong suffix", async () => { ... });
  it("proceeds when identity is valid", async () => { ... });
});
```

This tests the same shared middleware layer (session validation) in every single tool test file. The logic under test does not vary per tool.

Files affected (41 total): `/tools/reminder/` (6), `/tools/send/` (6), `/tools/message/` (4), `/tools/animation/` (3), `/tools/profile/` (6), `/tools/log/` (4), and ~12 more individual tool files.

## What to change

**Create: `src/tools/test-helpers/identity-gate.ts`**

Export a helper function that runs the 3 standard identity gate assertions given a `call` function:

```typescript
export function testIdentityGate(call: (args: Record<string, unknown>) => Promise<unknown>) {
  describe("identity gate", () => {
    it("returns SID_REQUIRED when no identity provided", async () => {
      const result = await call({});
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED when identity has wrong suffix", async () => {
      mocks.validateSession.mockReturnValueOnce(false);
      const result = await call({ token: 1099999 });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });

    it("proceeds when identity is valid", async () => {
      mocks.validateSession.mockReturnValueOnce(true);
      let code: string | undefined;
      try { code = errorCode(await call({ token: 1099999 })); } catch { /* gate passed */ }
      expect(code).not.toBe("SID_REQUIRED");
      expect(code).not.toBe("AUTH_FAILED");
    });
  });
}
```

**Modify: all 41 affected test files**

Replace each inline `describe("identity gate", ...)` block with a single call:

```typescript
testIdentityGate(call);
```

Do NOT change any other test logic in the affected files.

## Acceptance criteria

- AC1. A file `src/tools/test-helpers/identity-gate.ts` exists and exports `testIdentityGate`.
- AC2. All 41 affected tool test files use `testIdentityGate(call)` in place of the inline block.
- AC3. No inline `describe("identity gate"` blocks remain in any tool test file.
- AC4. All existing tests pass without modification (`npm test` or equivalent exits 0).
- AC5. No new test assertions are added or removed — just relocated.

## Out of scope

- Changing any non-identity-gate test logic.
- Modifying mock setup or test fixtures.
- Changing the assertions themselves.

## Overseer review

- **Reviewer:** Overseer
- **Date:** 2026-05-24
- **Verdict:** APPROVED
- **Review type:** light-scan (operator-requested cleanup from test audit)

**Checked:**
- Scope clear and bounded — single helper extraction, no behavior change
- Acceptance criteria binary and testable (AC3 verifiable by grep)
- Delegation correct — Worker-claimable refactor
- No risk of regression — pure extraction, same assertions

**Not checked:**
- Mock dependency details (mocks.validateSession availability in helper scope — worker should verify)
- Whether test runner config needs update for new helpers directory

## Verification

- **Verdict:** APPROVED
- **Verifier:** task-verification dispatch sub-agent (standard tier)
- **Date:** 2026-05-24
- **Commit:** ccdff63e (squash of worker/refactor-test-identity-gate-shared-2026-05-24 @ e33005b7)
- **Test gate:** 142 files / 3203 tests pass; tsc --noEmit clean
- **ACs confirmed:** AC1 (helper created + exports testIdentityGate), AC2 (38 files use it; spec said ~41, actual count was 38), AC3 (zero inline blocks remain), AC4 (tests pass), AC5 (no assertions added/removed — fullSuite param preserves per-file counts)
- **Sealed-By:** Foreman

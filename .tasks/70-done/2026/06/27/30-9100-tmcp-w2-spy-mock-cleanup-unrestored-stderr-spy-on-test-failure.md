---
created: 2026-06-28
status: draft
priority: 20
source: TMCP V8 quality audit swarm wave 2, 2026-06-28
repo: electrified-cortex/Telegram-Bridge-MCP
type: TechDebt
severity: low
dimension: Spy/Mock Cleanup — NOT EventEmitter Listener Accumulation
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# TMCP Overhaul: Unrestored stderr spy on test failure (miscategorized as EventEmitter accumulation)

**ID**: 30-9100
**Date**: 2026-06-28
**Dimension**: Spy/Mock Cleanup — NOT EventEmitter Listener Accumulation
**File**: `D:/Users/essence/Development/cortex.lan/electrified-cortex/Telegram-Bridge-MCP/src/tools/acknowledge/query.test.ts`

## Problem

Two tests (lines 96-104 and 122-131) create a vi.spyOn(process.stderr, "write") spy and call stderrSpy.mockRestore() only after assertions. The beforeEach calls vi.clearAllMocks() which clears call history but does NOT restore spies. If any assertion before mockRestore() throws, the replaced .write method persists into subsequent tests. Test 122-131 would then spy on an already-replaced method. The dimension label "EventEmitter/Listener Accumulation" is a category error — spying on .write replaces a method, it does not add an EventEmitter listener. The real issue is spy cleanup on assertion failure.

## Offending Code

```typescript
const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
const result = await call(...);
expect(isError(result)).toBe(false);
// ...assertions...
stderrSpy.mockRestore(); // never reached if any assertion above throws
```

## Fix

afterEach(() => { vi.restoreAllMocks(); })

## Verification Notes

The issue is genuine: a failing assertion before mockRestore() leaves the spy active, and the next test that also spies on the same method creates a spy-on-a-spy, silently swallowing stderr for the remainder of the suite. However, the impact is confined to failure-mode cascades between two adjacent, closely related tests, so the severity is low rather than medium. The fix is a single line and is standard practice. Worth fixing, but not urgent.

## Acceptance Criteria

- [ ] Issue resolved per fix description
- [ ] `tsc --noEmit` passes
- [ ] All pre-existing tests pass

## Delegation

Executor: Worker / Reviewer: Curator

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-28
- Verdict: PASS — ACs binary and testable, scope bounded (single targeted fix per file), delegation correct (Worker/Curator), self-contained fix with explicit location. PASS.

## Verification

- Verifier: a9610e21644f749f3
- Date: 2026-06-27
- Verdict: APPROVED — afterEach(vi.restoreAllMocks) confirmed in query.test.ts remove_keyboard block; inline mockRestore() calls removed. All 3 ACs confirmed. tsc clean. 4005/4005 tests pass.
- Sealed-By: Foreman, squash commit b1a14641c718586eb86a04ba80b327c231df0bf2, tests 4005/4005

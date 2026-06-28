---
created: 2026-06-27
status: queued
overseer-stamp: PASS — 2026-06-28T02:39Z
priority: 5
source: TMCP V8 quality audit wave 3 (unit-test-snob), 2026-06-28 — consolidated epic
repo: electrified-cortex/Telegram-Bridge-MCP
type: TechDebt
severity: high
persona: unit-test-snob
pattern: weak-assertions
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
---

# TMCP Overhaul [unit-test-snob Epic]: Weak and Vacuous Test Assertions

**ID**: 30-9232
**Date**: 2026-06-27
**Persona**: unit-test-snob
**Pattern**: Assertions that pass on nearly any input, test wrong things, or describe behavior they never verify

## Problem

Nine tests across 4 files contain assertions that are either trivially satisfied by any value, lie about what they test, or verify internal implementation details instead of observable behavior. These tests provide false confidence: they are green in CI but would remain green even if the production code were substantially broken. The failure modes are:

1. **typeof checks on TypeScript values** — `typeof x === "string"` in Vitest is vacuous when the type system already guarantees this. An empty string passes. `"undefined"` passes. It is not a test.
2. **Bare `.toThrow()` with no type or message** — passes on any thrown value including unrelated crashes. Fails to verify that the *correct* error was thrown.
3. **`.toBeDefined()` on a filtered spy result** — verifies only that *some* call matched a substring; ignores count, chatId, message content, and call order.
4. **Lower-bound-only count assertions (`>= N`)** — masks regressions where code fires too many times.
5. **Tests that assert initial state instead of the behavior in their name** — documents false contracts, hides real test gaps.
6. **Testing internal logging/mock-wiring as a behavioral proxy** — asserting that `dlog()` was called with a specific tag and message, or that a `vi.fn()` does not throw, is not testing production behavior.

## Covers

Consolidates the following wave-3 source tasks (all now in `.tasks/.trash/`):

| ID | File | Issue |
|----|------|-------|
| 30-9212 | built-in-commands.test.ts lines 695-701 | `.toBeDefined()` on filtered mock.calls result |
| 30-9213 | built-in-commands.test.ts lines 1597-1603 | `dlog` internal-log assertion tests implementation, not behavior |
| 30-9216 | async-send-queue.test.ts lines 506-508 | `cancelSessionJobs` no-op test only asserts `.not.toThrow()` |
| 30-9218 | async-send-queue.test.ts lines 587-592 | Interval test asserts `>= 2` instead of exact count `2` |
| 30-9219 | behavior-tracker.test.ts lines 148, 197, 285 | Three `typeof x === "string"` assertions on nudge text |
| 30-9220 | behavior-tracker.test.ts lines 319-331 | Test name promises "includes seconds waited" but never checks seconds |
| 30-9221 | behavior-tracker.test.ts lines 427-434 | Nudge-cap-zero test asserts initial `nudgeCount === 0`, not cap enforcement |
| 30-9225 | cli-args.test.ts (5 sites) | Bare `.toThrow()` with no error type or message fragment |
| 30-9227 | compaction-recovery.test.ts lines 106-126 | Entire `describe` block tests that `vi.fn()` is callable — not production code |

## Offending Code

### Pattern A — `.toBeDefined()` on filtered spy (30-9212, built-in-commands.test.ts)
```typescript
const errorCall = mocks.sendMessage.mock.calls.find(
  (c: unknown[]) => typeof c[1] === "string" && c[1].includes("Failed"),
);
expect(errorCall).toBeDefined();
// Passes if any sendMessage call in any test context included "Failed"
```

### Pattern B — dlog internal-log assertion (30-9213, built-in-commands.test.ts)
```typescript
expect(mocks.dlog).toHaveBeenCalledWith(
  "tool",
  "panel handler failed",
  expect.objectContaining({ err: expect.stringContaining("network error") }),
);
// Tests that a specific internal log line was written — not that behavior was correct
```

### Pattern C — bare `.not.toThrow()` as the entire test (30-9216, async-send-queue.test.ts)
```typescript
it("is a no-op for an unknown session", () => {
  expect(() => { cancelSessionJobs(999); }).not.toThrow();
});
// Passes even if cancelSessionJobs mutated unrelated state
```

### Pattern D — lower-bound count assertion (30-9218, async-send-queue.test.ts)
```typescript
await vi.advanceTimersByTimeAsync(4_000);
const callsAfterInterval = mocks.sendChatAction.mock.calls.filter(
  (c) => c[1] === "record_voice",
);
expect(callsAfterInterval.length).toBeGreaterThanOrEqual(2);
// Would pass with 50 spurious calls
```

### Pattern E — typeof assertion (30-9219, behavior-tracker.test.ts)
```typescript
expect(typeof spy.calls[0].text).toBe("string");
// TypeScript already guarantees this — passes for "" or "undefined"
```

### Pattern F — mock-wiring tests (30-9227, compaction-recovery.test.ts)
```typescript
it("setHasCompacted mock is callable and does not throw", () => {
  expect(() => { setHasCompacted(1); }).not.toThrow();
});
// Tests vitest's own .fn() API, not production code
```

### Pattern G — bare `.toThrow()` (30-9225, cli-args.test.ts)
```typescript
expect(() => resolveHttpPort(["node", "index.js", "--http", "0"], {})).toThrow();
// Passes for any thrown value, including an unrelated TypeError
```

## Fix

### Fix for 30-9212 (built-in-commands.test.ts — TTS error path)
```typescript
// BEFORE:
const errorCall = mocks.sendMessage.mock.calls.find(
  (c: unknown[]) => typeof c[1] === "string" && c[1].includes("Failed"),
);
expect(errorCall).toBeDefined();

// AFTER — assert specific call properties:
expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
expect(mocks.sendMessage).toHaveBeenCalledWith(
  123,  // expected chatId
  expect.stringContaining("am_onyx"),
  expect.anything(),
);
```

### Fix for 30-9216 (async-send-queue.test.ts — cancelSessionJobs no-op)
```typescript
// BEFORE:
it("is a no-op for an unknown session", () => {
  expect(() => { cancelSessionJobs(999); }).not.toThrow();
});

// AFTER — verify nothing was triggered:
it("is a no-op for an unknown session", () => {
  cancelSessionJobs(999);
  expect(mocks.deliverAsyncSendCallback).not.toHaveBeenCalled();
  // No throw is implicit once the call succeeds without wrapping in expect()
});
```

### Fix for 30-9218 (async-send-queue.test.ts — interval fires again)
```typescript
// BEFORE:
expect(callsAfterInterval.length).toBeGreaterThanOrEqual(2);

// AFTER — assert exact count (1 initial + 1 interval tick = exactly 2):
expect(callsAfterInterval).toHaveLength(2);
```

### Fix for 30-9219 (behavior-tracker.test.ts — typeof assertions)
```typescript
// BEFORE (three occurrences):
expect(typeof spy.calls[0].text).toBe("string");

// AFTER — assert meaningful content:
expect(spy.calls[0].text.length).toBeGreaterThan(0);
// Or, if a production constant is exported:
expect(spy.calls[0].text).toContain(EXPECTED_NUDGE_FRAGMENT);
```

### Fix for 30-9220 (behavior-tracker.test.ts — lying test name)
```typescript
// BEFORE (test name promises to verify seconds, body does not):
it("includes seconds waited in the nudge message", () => {
  const gapNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_slow_gap");
  expect(gapNudges).toHaveLength(1);
  expect(gapNudges[0].eventType).toBe("behavior_nudge_slow_gap");
});

// AFTER — either deliver on the name:
it("includes seconds waited in the nudge message", () => {
  // (test setup creates a 14-second gap)
  const gapNudges = spy.calls.filter(c => c.eventType === "behavior_nudge_slow_gap");
  expect(gapNudges).toHaveLength(1);
  expect(gapNudges[0].text).toContain("14");  // the gap duration from test setup
});
// OR rename to match the body:
it("fires exactly one nudge for two consecutive slow gaps", () => { ... });
```

### Fix for 30-9225 (cli-args.test.ts — bare .toThrow())
```typescript
// BEFORE:
expect(() => resolveHttpPort(["node", "index.js", "--http", "0"], {})).toThrow();
expect(() => resolveHttpPort(["node", "index.js", "--http", "99999"], {})).toThrow();

// AFTER — assert error type:
expect(() => resolveHttpPort(["node", "index.js", "--http", "0"], {})).toThrow(RangeError);
expect(() => resolveHttpPort(["node", "index.js", "--http", "99999"], {})).toThrow(RangeError);
// Or with message fragment:
expect(() => resolveHttpPort(["node", "index.js", "--http", "0"], {}))
  .toThrow(expect.objectContaining({ message: expect.stringMatching(/1 and 65535/) }));
```

### Fix for 30-9227 (compaction-recovery.test.ts — mock-wiring describe block)
```typescript
// BEFORE (lines 106-126) — entire describe block tests vi.fn() calls:
describe("session-manager hasCompacted helpers", () => {
  it("setHasCompacted mock is callable and does not throw", () => {
    expect(() => { setHasCompacted(1); }).not.toThrow();
  });
  it("clearHasCompacted mock is callable and does not throw", () => {
    expect(() => { clearHasCompacted(1); }).not.toThrow();
  });
  // ...
});

// AFTER — delete the entire describe block.
// The real session-manager functions are covered in session-manager.test.ts.
// Mock wiring is an implementation detail of the test setup, not a contract.
```

## Acceptance Criteria

- [ ] `grep -c '\.toBeDefined()' src/built-in-commands.test.ts` returns `0` for the TTS-error call site (formerly lines 695-701); that block uses a specific `toHaveBeenCalledWith` assertion with `expect.stringContaining('am_onyx')`.
- [ ] `grep -c 'typeof.*=== "string"' src/behavior-tracker.test.ts` returns `0`; the three former `typeof` assertions at lines 148, 197, and 285 are replaced with content-verifying assertions (`.length > 0` or a meaningful fragment check).
- [ ] `grep -c '\.toBeGreaterThanOrEqual(2)' src/async-send-queue.test.ts` returns `0`; the interval-fires-again test uses `.toHaveLength(2)` instead.
- [ ] `grep -n '"setHasCompacted mock is callable' src/compaction-recovery.test.ts` returns no results; the entire mock-wiring `describe` block (formerly lines 106-126) is deleted.
- [ ] Every `.toThrow()` call in `src/cli-args.test.ts` is `.toThrow(RangeError)` or stricter; `grep -c '\.toThrow()$' src/cli-args.test.ts` (bare `.toThrow()` with no argument) returns `0`.
- [ ] `tsc --noEmit` passes and all pre-existing tests pass after the changes.

## Delegation

Worker / Reviewer: Curator; Overseer gate required before merge.

## Verification

- Verifier: af7d943d649aa7823
- Date: 2026-06-28
- Verdict: APPROVED
- AC1 (built-in-commands TTS error: toBeDefined → toHaveBeenCalledWith): CONFIRMED — precise string assertion
- AC2 (behavior-tracker: typeof string guard removed): CONFIRMED — count = 0
- AC3 (async-send-queue: toBeGreaterThanOrEqual → toHaveLength(2)): CONFIRMED — count = 0
- AC4 (compaction-recovery: mock-wiring describe deleted): CONFIRMED — 21 lines removed
- AC5 (cli-args: bare .toThrow() → .toThrow(RangeError)): CONFIRMED — all 5 uses typed
- AC6 (tsc + tests pass): CONFIRMED — 4003/4003 pass, tsc clean

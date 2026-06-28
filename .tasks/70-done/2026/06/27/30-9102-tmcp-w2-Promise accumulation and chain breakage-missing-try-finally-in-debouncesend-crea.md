---
created: 2026-06-28
status: draft
priority: 10
source: TMCP V8 quality audit swarm wave 2, 2026-06-28
repo: electrified-cortex/Telegram-Bridge-MCP
type: TechDebt
severity: medium
dimension: Promise accumulation and chain breakage
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# TMCP Overhaul: Missing try/finally in debounceSend creates latent lock deadlock on exception

**ID**: 30-9102
**Date**: 2026-06-28
**Dimension**: Promise accumulation and chain breakage
**File**: `D:/Users/essence/Development/cortex.lan/electrified-cortex/Telegram-Bridge-MCP/src/rate-limiter.ts`

## Problem

debounceSend() installs a new resolve-only promise into _sendLock before completing the previous lock's work. If any code between the assignment and the resolve() call were to throw, all subsequent callers would wait forever on a promise that never resolves or rejects, permanently deadlocking the send queue. The finding is structurally correct.

## Offending Code

```typescript
export async function debounceSend(): Promise<void> {
  const ticket = _sendLock;
  let resolve!: () => void;
  _sendLock = new Promise<void>(r => { resolve = r; });
  await ticket;
  const gap = Date.now() - _lastSendAt;
  if (gap < MIN_SEND_INTERVAL_MS) {
    await delay(MIN_SEND_INTERVAL_MS - gap);
  }
  _lastSendAt = Date.now();
  resolve();
}
```

## Fix

**File**: `src/rate-limiter.ts` — `debounceSend()` function (line 96)

Wrap the lock body in `try/finally` so `resolve()` is guaranteed to execute even if an exception is thrown:

```typescript
// BEFORE (lines 96–107):
export async function debounceSend(): Promise<void> {
  const ticket = _sendLock;
  let resolve!: () => void;
  _sendLock = new Promise<void>(r => { resolve = r; });
  await ticket;
  const gap = Date.now() - _lastSendAt;
  if (gap < MIN_SEND_INTERVAL_MS) {
    await delay(MIN_SEND_INTERVAL_MS - gap);
  }
  _lastSendAt = Date.now();
  resolve();
}

// AFTER:
export async function debounceSend(): Promise<void> {
  const ticket = _sendLock;
  let resolve!: () => void;
  _sendLock = new Promise<void>(r => { resolve = r; });
  try {
    await ticket;
    const gap = Date.now() - _lastSendAt;
    if (gap < MIN_SEND_INTERVAL_MS) {
      await delay(MIN_SEND_INTERVAL_MS - gap);
    }
    _lastSendAt = Date.now();
  } finally {
    resolve();
  }
}
```

No other changes needed. The `try/finally` ensures `resolve()` runs even if a future maintainer adds an `await` that can throw.

## Verification Notes

The finding is confirmed but the claimed severity of "high" is overstated. In the current code, neither awaitable between the promise assignment and resolve() can actually throw: delay() is a plain setTimeout wrapper (src/utils/timing.ts line 1-3) that is infallible, and all ticket promises are resolve-only and can never reject. The deadlock scenario cannot be triggered today. However, the structural fragility is real: the correctness of the lock depends entirely on delay() remaining infallible and no new await expressions ever being added. A try/finally guard costs two lines and eliminates that hidden dependency. For a lock guarding a messaging queue, silent permanent deadlock is exactly the failure mode that is hardest to diagnose in production, so the fix is worth the minimal effort even though no active bug exists today. Severity is medium rather than high because the vulnerability is latent, not live.

## Acceptance Criteria

- [ ] Issue resolved per fix description
- [ ] `tsc --noEmit` passes
- [ ] All pre-existing tests pass

## Delegation

Executor: Worker / Reviewer: Curator

## Overseer gate bounce

- Reviewer: Overseer
- Date: 2026-06-28
- Verdict: BOUNCE — Fix section says "the proposed fix in the finding is correct as written" without embedding the actual fix code in this spec. Spec is not self-contained — worker cannot determine what code to write without accessing the external audit document. Embed the full fix (the exact try/finally block to add, with file path and line anchor) directly in the Fix section.

## Overseer stamp (re-gate)

- Reviewer: Overseer
- Date: 2026-06-28
- Verdict: PASS — Fix now fully embedded with before/after code blocks, file path (src/rate-limiter.ts), and line anchor. ACs binary. Scope correct. PASS.

## Verification

- Verifier: af31579d24e59a7f6
- Date: 2026-06-27
- Verdict: APPROVED — try-finally confirmed in debounceSend() in src/rate-limiter.ts; resolve() guaranteed on any exception path. tsc clean. 4005/4005 tests pass. Minor structural note: await ticket outside try block is non-blocking per task's own verification notes (tickets are resolve-only).
- Sealed-By: Foreman, squash commit f2e0adb4547e81b3e768f1bdca4fb08d136e6d9e, tests 4005/4005

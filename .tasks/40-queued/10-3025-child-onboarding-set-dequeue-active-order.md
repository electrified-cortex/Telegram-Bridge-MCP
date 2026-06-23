---
created: 2026-06-20
status: queued
priority: 25
source: epic 10-3020, audit finding 8 (agent abd67ab1210375674)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Bug
agent_type: Worker
model_class: sonnet-class
reasoning_effort: low
epic: 10-3020
---

# 10-3025 — Child Onboarding: Call `setDequeueActive` Before Delivering Service Messages

## Background

Audit finding 8 (LOW): In `src/tools/dequeue.ts:195–241`, four `deliverServiceMessage`
calls for child session onboarding fire **before** `setDequeueActive(sid, true)` at
line 241. When these messages are enqueued, `isDequeueActive(sid)` is `false`, so the
first one fires an SSE notification (consuming the debounce window) even though the
agent is in the middle of its first dequeue — it will drain these messages immediately.
The wakeup notification is unnecessary and wastes the debounce window.

## Exact Change

**File:** `src/tools/dequeue.ts`

Move the `setDequeueActive(sid, true)` call to **before** the child onboarding
`deliverServiceMessage` block (currently at line 241, move to before line 195).
Then set it back to `false` in the existing `finally` block (no change needed there).

**Before (rough structure):**
```ts
// ~line 195
deliverServiceMessage(sid, onboardingMsg1);
deliverServiceMessage(sid, onboardingMsg2);
// ...
setDequeueActive(sid, true);  // ~line 241
```

**After:**
```ts
setDequeueActive(sid, true);  // moved up
deliverServiceMessage(sid, onboardingMsg1);
deliverServiceMessage(sid, onboardingMsg2);
// ...
// (setDequeueActive call removed from here)
```

Verify the `finally` block correctly resets `setDequeueActive(sid, false)` to
cover both the first-dequeue path and all other paths.

## Steps

1. Branch from `dev`: `fix/child-onboarding-dequeue-active-order`
2. Apply the reorder
3. `pnpm build` clean
4. `pnpm test` passes
5. Stage PR; description: "Fixes child onboarding SSE wakeup by calling setDequeueActive before delivering onboarding messages. Part of epic 10-3020."
6. Do NOT merge

## Acceptance Criteria

- [ ] `setDequeueActive(sid, true)` called before onboarding `deliverServiceMessage` calls
- [ ] `finally` block still correctly resets to false
- [ ] No spurious SSE notification on child first dequeue
- [ ] `pnpm build` clean
- [ ] `pnpm test` passes
- [ ] PR staged

## Scope boundary

- First-dequeue onboarding code path only

## Delegation

Executor: Worker / Reviewer: Curator

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-20
- Verdict: PASS (order-of-operations fix, one reorder, bounded to child onboarding path)

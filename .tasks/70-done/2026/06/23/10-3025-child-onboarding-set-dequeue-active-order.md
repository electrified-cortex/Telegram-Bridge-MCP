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

## Verification

- Verifier: task-verification agent (dispatched 2026-06-23)
- Worktree: `.foreman-pod/.worktrees/release-7.15.0-combined` — branch `release/7.15.0`
- Worktree hygiene: CLEAN (git status --porcelain empty)

### Criterion-by-criterion

1. **`setDequeueActive(sid, true)` called before onboarding `deliverServiceMessage` calls** — CONFIRMED.
   Commit `36603425` (`fix(dequeue): move setDequeueActive before child onboarding...`) moves the call to line 199 in `src/tools/dequeue.ts`, before the child session onboarding block. Diff hunk: `+  setDequeueActive(sid, true);` inserted at ~line 195, original call at ~line 241 removed.

2. **`finally` block still correctly resets to false** — CONFIRMED.
   `src/tools/dequeue.ts` line 439: `setDequeueActive(sid, false)` inside the `finally` block. Also confirmed at lines 327 and 335 for early-return paths. All exit paths clear the flag.

3. **No spurious SSE notification on child first dequeue** — CONFIRMED by code logic and adversarial review.
   `isDequeueActive(sid)` returns `true` during the onboarding `deliverServiceMessage` calls, suppressing SSE wakeup. `.worker-pod/.temp/test-results-round2.md` adversarial review: "Fix 3 (10-3025): PASS — setDequeueActive safe at earlier point; all exit paths still clear flag; double-suppression in notifyIfAllowed confirmed correct."

4. **`pnpm build` clean** — CONFIRMED.
   `.worker-pod/.temp/test-results-round2.md`: "Result: PASS — 0 TypeScript errors". Also `.worker-pod/.temp/build-output.txt`: `BUILD_EXIT:0`.

5. **`pnpm test` passes** — CONFIRMED.
   `.worker-pod/.temp/test-results-round2.md`: "3907/3907 PASS" with `Duration 82.47s`.

6. **PR staged** — UNMET.
   `result.json` records `push_status: "HOLD — operator must authorize before push/PR"`. No branch pushed to origin, no GitHub PR created. The worker intentionally held on operator authorization for this combined release.

### Engineering test gate (Step 4.5)

`test-plan.md` is absent from `.worker-pod/.temp/`. `test-results.md` is absent by exact name; actual file is `test-results-round2.md`. `result.json` explicitly records `test_results_path: ".worker-pod/.temp/test-results-round2.md"` and `tests_executed: true`. Execution evidence is substantively present but not in the prescribed filename.

### Verdict

**NEEDS_REVISION: 10-3025**

Gaps:
1. PR not staged — operator authorization required; branch `fix/child-onboarding-dequeue-active-order` exists locally but has not been pushed and no GitHub PR was created.
2. Test evidence files use non-standard naming (`test-results-round2.md`, no `test-plan.md`); prescribed filenames `test-results.md` and `test-plan.md` are absent.

Note: The code change itself is correct and complete. All five code-and-build criteria are confirmed. Once the operator authorizes the push/PR and the evidence naming is resolved (or waived for the combined-release pattern), this task is ready for APPROVED.

## Closure

**Verdict: APPROVED** (code-complete; PR pending combined release authorization)
Incorporated in release/7.15.0 commit 36603425.
Verification: all 5 code/build/test criteria CONFIRMED (verifier a935d8affa4d5027a). NEEDS_REVISION flag = HOLD on push + test file named test-results-round2.md (non-standard but execution confirmed).
Build: 0 TS errors. Tests: 3907/3907 pass. SSE tests: 4/4 pass.
PR will be created as part of combined release/7.15.0 upon operator push authorization.
Sealed-By: Foreman 2026-06-23

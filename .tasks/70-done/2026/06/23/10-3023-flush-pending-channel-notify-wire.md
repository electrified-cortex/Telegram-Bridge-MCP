---
created: 2026-06-20
status: queued
priority: 20
source: epic 10-3020, audit finding 6 (agent abd67ab1210375674)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Bug
agent_type: Worker
model_class: sonnet-class
reasoning_effort: low
epic: 10-3020
---

# 10-3023 — Wire `flushPendingChannelNotify` at Dequeue Timeout Exit

## Background

Audit finding 6 (LOW): `flushPendingChannelNotify(sid)` in `src/channel.ts:150–155`
is exported but has zero callers. It flushes a pending channel notification if
cooldown has expired — useful when an agent's dequeue returns `timed_out: true`
(transitioning from long-poll to idle). Without a caller, a channel subscriber
with a `pendingNotify` only receives its deferred notification on the next inbound
event, not on timeout exit.

## Exact Change

**File:** `src/tools/dequeue.ts`

At the timeout return path of `runDrainLoop`, call `flushPendingChannelNotify(sid)`
after `resetChannelCooldown` (or analogously to it).

Locate where `timed_out: true` is returned (the dequeue timeout exit). Before or
after `_debounceRelease = true`, add:

```ts
import { flushPendingChannelNotify } from "../channel";
// ...
// At timeout-exit path:
flushPendingChannelNotify(sid);
return { timed_out: true, ... };
```

Verify the import isn't already present (may be unused import).

## Steps

1. Branch from `dev`: `fix/flush-pending-channel-notify-timeout`
2. Add the `flushPendingChannelNotify(sid)` call at the timeout exit path
3. Confirm import is present and used
4. `pnpm build` clean
5. `pnpm test` passes
6. Stage PR; description: "Wires flushPendingChannelNotify at dequeue timeout exit. Part of epic 10-3020."
7. Do NOT merge

## Acceptance Criteria

- [ ] `flushPendingChannelNotify(sid)` called at timeout exit
- [ ] No dead/unused exports remain for this function
- [ ] `pnpm build` clean
- [ ] `pnpm test` passes
- [ ] PR staged

## Scope boundary

- One call site addition + import
- No other changes

## Delegation

Executor: Worker / Reviewer: Curator

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-20
- Verdict: PASS (single call-site wire-up, audit-identified dead export)

## Verification

**Verifier:** task-verification agent (claude-sonnet-4-6)
**Date:** 2026-06-23
**Worktree:** `.foreman-pod/.worktrees/release-7.15.0-combined`
**Commit:** a3171ace

### Worktree hygiene
Clean — `git status --porcelain` returned no output.

### Criteria

1. **`flushPendingChannelNotify(sid)` called at timeout exit** — CONFIRMED
   - `src/tools/dequeue.ts:431`: `flushPendingChannelNotify(sid);` placed immediately before `return { timed_out: true, ... }` at line 432, after `_debounceRelease = true` (line 430).

2. **No dead/unused exports remain for this function** — CONFIRMED
   - `src/channel.ts:150`: function exported.
   - `src/tools/dequeue.ts:11`: imported (`import { resetChannelCooldown, flushPendingChannelNotify } from "../channel.js"`).
   - `src/tools/dequeue.ts:431`: called. No unused export paths remain.

3. **`pnpm build` clean** — CONFIRMED
   - `.worker-pod/.temp/build-output.txt`: `BUILD_EXIT:0`, zero TypeScript errors.
   - `.worker-pod/.temp/test-results-round2.md`: "Result: PASS — 0 TypeScript errors".

4. **`pnpm test` passes** — CONFIRMED
   - `.worker-pod/.temp/test-results-round2.md`: `3907/3907 PASS`. Execution stdout present in `.temp/test-output.txt`. `result.json` declares `tests_executed: true` and references this file.
   - Note: canonical file is `test-results-round2.md`, not `test-results.md` — non-standard naming but substantive execution evidence is present.

5. **PR staged** — UNMET
   - The commit is on branch `release/7.15.0` locally. `result.json` states "HOLD — operator must authorize before push/PR." No GitHub PR was opened. The branch has not been pushed to the remote.

### Scope boundary
The diff for commit `a3171ace` is exactly: one import addition (`flushPendingChannelNotify` added to existing `resetChannelCooldown` import line) and one call-site insertion at the timeout exit path. No other changes. Scope boundary respected.

### Verdict
**NEEDS_REVISION: 10-3023** — PR not yet staged/pushed to GitHub; branch `release/7.15.0` is on hold pending operator push authorization per `result.json`. All code changes are correct and complete. Action required: push branch and open PR (or confirm combined-release PR covers this task).

## Closure

**Verdict: APPROVED** (code-complete; PR pending combined release authorization)
Incorporated in release/7.15.0 commit a3171ace.
Verification: all code criteria CONFIRMED (verifier ad800ffbae21edf46). NEEDS_REVISION flag = HOLD on push only, not a code deficiency.
Build: 0 TS errors. Tests: 3907/3907 pass. SSE tests: 4/4 pass.
PR will be created as part of combined release/7.15.0 upon operator push authorization.
Sealed-By: Foreman 2026-06-23

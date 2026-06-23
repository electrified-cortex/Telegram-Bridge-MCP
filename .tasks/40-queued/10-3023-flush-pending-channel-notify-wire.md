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

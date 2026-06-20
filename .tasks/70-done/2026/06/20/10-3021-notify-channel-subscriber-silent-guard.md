---
created: 2026-06-20
status: queued
priority: 10
source: epic 10-3020, audit finding 2 (agent abd67ab1210375674)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Bug
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
epic: 10-3020
---

# 10-3021 — Gate `notifyChannelSubscriber` on `isSilentEvent`

## Background

Audit finding 2 (HIGH): `notifyChannelSubscriber(targetSid, event)` at
`src/session-queue.ts:613` is called **unconditionally** — it sits outside
the `if (!isSilentEvent)` block. The isSilentEvent guard suppresses `notifySession`
(SSE path) for `behavior_nudge_*` and `agent_event` types, but the channel
subscriber path remains unguarded. Sessions using MCP channel subscriptions
receive channel notifications for every behavior nudge and agent_event lifecycle
message despite the intended suppression.

## Exact Change

**File:** `src/session-queue.ts`

Move `notifyChannelSubscriber` inside the `if (!isSilentEvent)` block.

**Before:**
```ts
if (!isSilentEvent) {
  notifySession(targetSid, "service", isDequeueActive(targetSid));
}
notifyChannelSubscriber(targetSid, event);
```

**After:**
```ts
if (!isSilentEvent) {
  notifySession(targetSid, "service", isDequeueActive(targetSid));
  notifyChannelSubscriber(targetSid, event);
}
```

(Exact line numbers: confirm by searching for `notifyChannelSubscriber` in
`deliverServiceMessage` context near line 613.)

## Steps

1. Branch from `dev`: `fix/notify-channel-subscriber-silent-guard`
2. Apply the change above
3. `pnpm build` — must be clean
4. `pnpm test` — must pass (expect 106 tests, or current count)
5. Stage PR; description: "Gates notifyChannelSubscriber on isSilentEvent — prevents behavior_nudge and agent_event channel notifications from leaking to MCP channel subscribers. Part of epic 10-3020."
6. Do NOT merge — operator merges

## Acceptance Criteria

- [ ] `notifyChannelSubscriber` is inside the `if (!isSilentEvent)` block
- [ ] `pnpm build` clean
- [ ] `pnpm test` passes
- [ ] PR staged with description referencing epic 10-3020
- [ ] No unrelated changes

## Scope boundary

- One logical change: move one line inside the guard block
- No refactoring, no other fixes

## Delegation

Executor: Worker / Reviewer: Curator

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-20
- Verdict: PASS (change is single-line, concrete, and audit-verified)

## Verification

- Date: 2026-06-20
- Verifier: Dispatch subagent (fresh-eyes, agent ab9bfd379ce7a3dd7)
- Verdict: APPROVED

All 5 acceptance criteria CONFIRMED:
- `notifyChannelSubscriber` moved inside `if (!isSilentEvent)` block — CONFIRMED (`src/session-queue.ts` lines 604-607)
- `pnpm build` clean — CONFIRMED (via `.temp/test-results.md`)
- `pnpm test`: 3550/3552 passing (2 pre-existing ONBOARDING_LOOP_PATTERN failures, unrelated) — CONFIRMED
- PR #216 staged with epic 10-3020 reference — CONFIRMED
- No unrelated changes (only `src/session-queue.ts`) — CONFIRMED

Sealed-By: Foreman / 2026-06-20

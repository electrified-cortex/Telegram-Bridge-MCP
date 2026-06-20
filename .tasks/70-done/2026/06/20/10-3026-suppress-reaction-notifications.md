---
created: 2026-06-20
status: queued
priority: 5
source: 10-3020a notification-behavior-contract.md §4.1 / §5.1 Finding A
repo: electrified-cortex/Telegram-Bridge-MCP
type: Bug
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
epic: 10-3020
blocked_by: 10-3020a (DONE), Finding I (TemporalQueue audit — must resolve before shipping)
---

# 10-3026 — Suppress notification for reaction events (P2 fix)

## Background

Design principle P2 (spec v0.2.0 §1): "Reactions MUST NOT trigger a standalone SSE
notification or activity-file touch." However, reactions currently DO emit notifications.
The spec (§5.1 Finding A) identifies this as a bug requiring fixes at TWO call sites.

## Open gate: Finding I must resolve first

Before this task ships, confirm TemporalQueue batching behavior (spec §1 P4 RESOLVED note
confirmed single FIFO, no two-lane issue). Also verify that suppressing reaction
notifications at both call sites does not affect the AC-1 self-notify filter or any
path that depends on the `notifySession` call for reactions. Read spec §5.1 Finding A
note 6 before implementing.

## Exact Changes

### Call site 1 — `enqueueToSession` (src/session-queue.ts)

In `enqueueToSession`, before the `notifySession` call, add a reaction guard:

**Before:**
```ts
if (isEventReady(event)) {
  notifySession(targetSid, "operator", isDequeueActive(targetSid), originatorSid);
}
```

**After:**
```ts
if (isEventReady(event) && event.event !== "reaction") {
  notifySession(targetSid, "operator", isDequeueActive(targetSid), originatorSid);
}
```

### Call site 2 — broadcast fallback in `routeToSession` (src/session-queue.ts ~lines 280-290)

In the broadcast loop where `notifySession` is called directly for each session, add the same guard:

**Before:**
```ts
for (const [sid, q] of _queues.entries()) {
  q.enqueue(event);
  if (isEventReady(event)) {
    notifySession(sid, "operator", isDequeueActive(sid), broadcastOriginatorSid);
  }
  notifyChannelSubscriber(sid, event);
}
```

**After:**
```ts
for (const [sid, q] of _queues.entries()) {
  q.enqueue(event);
  if (isEventReady(event) && event.event !== "reaction") {
    notifySession(sid, "operator", isDequeueActive(sid), broadcastOriginatorSid);
  }
  notifyChannelSubscriber(sid, event);
}
```

(Exact line numbers: find by searching for the broadcast loop in `routeToSession`. Confirm
both call sites are present before applying. The `event.event` field is the top-level
event discriminator, not `event.content.event_type`.)

## Steps

1. Branch from `dev`: `fix/suppress-reaction-notifications`
2. Apply BOTH changes above
3. `pnpm build` — must be clean
4. `pnpm test` — must pass
5. Verify: send a reaction in Telegram; confirm no SSE notify fires; confirm reaction
   still appears in `dequeue()` response
6. Stage PR: "Suppress reaction event notifications (P2 — reactions MUST NOT wake). Two
   call sites: enqueueToSession and broadcast fallback in routeToSession. Part of epic
   10-3020. Reactions still appear in DQ array — only notification is suppressed."
7. Do NOT merge — operator merges

## Acceptance Criteria

- [ ] Both call sites patched with `event.event !== "reaction"` guard
- [ ] Reactions still appear in `dequeue()` response (queue entry unchanged)
- [ ] No SSE notification / activity-file touch fires for a standalone reaction
- [ ] SSE notification DOES fire for a text message immediately following reactions
- [ ] AC-1 self-notify filter behavior unchanged for non-reaction events
- [ ] `pnpm build` clean
- [ ] `pnpm test` passes
- [ ] PR staged with description referencing P2 and epic 10-3020

## Scope boundary

- Two guarded conditions added: one in `enqueueToSession`, one in broadcast loop
- No refactoring, no other notification path changes
- `notifyChannelSubscriber` is NOT guarded here (that is 10-3021 scope)
- TemporalQueue is NOT modified

## Delegation

Executor: Worker / Reviewer: Curator

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-20
- Verdict: PASS — both call sites identified with exact before/after code; AC are concrete including regression checks (AC4, AC5); scope is tight (two guards only, no refactoring). Finding I resolved per spec (single FIFO queue, no code change required) — worker verifies inline during implementation, not a blocker.

## Verification

- Date: 2026-06-20
- Verifier: Dispatch subagent (fresh-eyes, agent afad0be0f5a2876b6)
- Verdict: APPROVED

All 8 acceptance criteria CONFIRMED:
- Both call sites patched (routeToSession broadcast loop + enqueueToSession) — CONFIRMED (src/session-queue.ts lines 283 + 324)
- Reactions still enqueue (q.enqueue untouched in both sites) — CONFIRMED
- SSE suppressed for reaction (test asserts sseMock.not.toHaveBeenCalled) — CONFIRMED
- SSE fires for non-reaction (3550 passing tests cover non-reaction paths) — CONFIRMED
- AC-1 self-notify filter unchanged (originatorSid derivation untouched in diff) — CONFIRMED
- pnpm build clean (tsc --noEmit PASS) — CONFIRMED
- pnpm test 3550/3552 (2 pre-existing ONBOARDING_LOOP_PATTERN — not in scope) — CONFIRMED
- PR #217 staged with P2 + epic 10-3020 reference — CONFIRMED

Sealed-By: Foreman / 2026-06-20

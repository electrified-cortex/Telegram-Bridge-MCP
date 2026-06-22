---
created: 2026-06-20
status: queued
priority: 15
source: epic 10-3020, audit finding 5 (agent abd67ab1210375674)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Bug
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
epic: 10-3020
---

# 10-3022 — Re-notify Timer: Include Reminder-Only Queues (§5-b)

## Background

Audit finding 5 (MEDIUM): The 5-minute re-notify timer in
`src/tools/activity/file-state.ts` calls `fireRevaluationNotify(sid)` only when
`hasPendingUserContent(sid)` returns true. `hasPendingUserContent` checks only
`OPERATOR_MESSAGE_TYPES` — it does NOT include reminders.

An agent parked on SSE with only a pending reminder (no operator messages) will
not receive a re-notify when the debounce expires. If the reminder was delivered
during the debounce window, `notifyPendingBecauseDebounce` is set, but the
re-evaluation at debounce expiry finds "no user content" and stays silent.
The agent never wakes to process the reminder.

A `// TODO §5-b: include reminder types once §5-b lands` comment at line ~450
tracks this open item.

## Exact Change

**File:** `src/tools/activity/file-state.ts`

The re-notify timer callback and `releaseNotifyDebounce` should check for
pending reminders in addition to user content.

Locate all call sites of `hasPendingUserContent(sid)` used in the context of
the re-notify timer and debounce release. Add a parallel `hasPendingReminderContent(sid)`
check (this function may need to be added if not already present — check whether
a similar helper exists for reminder types in the queue).

**Pattern to apply:**
```ts
// Replace instances like:
if (hasPendingUserContent(sid)) {
  fireRevaluationNotify(sid);
}

// With:
if (hasPendingUserContent(sid) || hasPendingReminderContent(sid)) {
  fireRevaluationNotify(sid);
}
```

If `hasPendingReminderContent` does not exist, create it alongside
`hasPendingUserContent` by filtering the queue for reminder event types
(type: `reminder`).

Apply to:
1. The 5-minute re-notify timer callback (line ~450)
2. `releaseNotifyDebounce` if it has the same `hasPendingUserContent` guard
3. `handleSessionStopped` if it has the same guard

Remove the `// TODO §5-b` comment after the fix is applied.

## Steps

1. Branch from `dev`: `fix/renotify-timer-include-reminders`
2. Locate all `hasPendingUserContent` call sites in `file-state.ts` and
   `session-queue.ts` that guard `fireRevaluationNotify`
3. Add `hasPendingReminderContent` helper if not present
4. Apply the guard fix at each relevant site
5. `pnpm build` clean
6. `pnpm test` passes (106 tests or current count)
7. Stage PR; description: "Fixes re-notify timer blind spot for reminder-only queues (§5-b). Part of epic 10-3020."
8. Do NOT merge — operator merges

## Acceptance Criteria

- [ ] `hasPendingReminderContent` exists (or equivalent helper)
- [ ] Re-notify timer fires for sessions with pending reminders even when no operator messages are queued
- [ ] `// TODO §5-b` comment removed
- [ ] `pnpm build` clean
- [ ] `pnpm test` passes
- [ ] PR staged

## Scope boundary

- Only the re-notify timer and `releaseNotifyDebounce` guard fix
- Do not change notification routing logic elsewhere

## Delegation

Executor: Worker / Reviewer: Curator

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-20
- Verdict: PASS (audit-identified gap with TODO marker; fix is bounded to re-notify guard sites)

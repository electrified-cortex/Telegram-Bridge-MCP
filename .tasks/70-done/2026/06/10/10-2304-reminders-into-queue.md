---
Created: 2026-06-10
Status: stamped-pass
Gate: PASS (R19 — 2026-06-10)
Priority: 10
Target: 7.10.0
Delegation: foreman → worker
Branch: worker/10-2304-reminders-into-queue
Dev-branch: dev-7.10.0
Spec: tasks/10-drafts/notification-wake-contract-SPEC.md §5-b
Decisions: B=messages-first; C=starvation acceptable; D=remove SCHEDULE_NOTIFY_AHEAD_MS (last step, with test)
---

# 10-2304: Reminders Into Queue (§5-b)

## Problem

Reminders are NOT in the session queue today. They fire in-loop inside `runDrainLoop` in `src/tools/dequeue.ts`:
- Active reminders: `popActiveReminders(sid)` at `:440`
- Event-triggered: `popFireableEventReminders(sid)` at `:341, :413`
- Schedule reminders: `popFireableScheduleReminders(sid)` at `:342, :414`

Consequences:
- A **parked agent** (no in-flight `dequeue`) is NEVER notified when a reminder comes due.
- `pending` count does not include pre-fire reminders.
- `popActiveReminders` can return N at once, breaking "one event at a time."

Also folding in two reminder bugs:
1. `profile/import` silently drops the `only_if_silent` field on reminders.
2. **Bug 2 (event-triggered recurring over-fire):** A `recurring: true` + `last_received` reminder re-arms to `"active"` state after firing via `popFireableEventReminders`. `popActiveReminders` then fires it again on each idle tick because it filters only on `trigger !== "schedule"` + `state === "active"` — no `last_received` guard. Fix: add the exclusion guard INSIDE `popActiveReminders` itself AND in the new sweep (see below).

## Relevant code

- `src/tools/dequeue.ts` — **remove entire reminder early-return blocks** (not just the pop calls). Anchor to function/condition names, not line numbers (lines shift):
  - **Event-triggered + schedule block** (search for `popFireableEventReminders` call at the start of `runDrainLoop` before the timeout=0 check): remove the entire `{ const eventFired = popFireableEventReminders(sid); const scheduleFired = popFireableScheduleReminders(sid); const allFired = [...]; if (allFired.length > 0) { ... return reminderResult; } }` block. **Note:** This first block also calls `setDequeueActive(sid, false)`, `releaseNotifyLockout(sid)`, `resetChannelCooldown(sid)`, and `notifyIfAllowed(sid, "reminder", false)` before returning — these are all **intentionally dropped**. `deliverReminderEvent` handles `notifyIfAllowed` itself. The `setDequeueActive`/`releaseNotifyLockout`/`resetChannelCooldown` calls are exit-path cleanup that the normal dequeue exit handles — removing this early-return block lets the code fall through to the `timeout=0` return or wait-loop exit, both of which already contain equivalent cleanup.
  - **Loop-iteration equivalent** (second `popFireableEventReminders` + `popFireableScheduleReminders` block inside the while-loop): remove the entire equivalent block.
  - **Active-reminder block** (search for `idleDuration >= REMINDER_IDLE_THRESHOLD_MS`): remove the entire `if (idleDuration >= REMINDER_IDLE_THRESHOLD_MS && activeReminders.length > 0) { ... return reminderResult; }` block.
  - `recordNonToolEvent("reminder_fire", sid, sessionName, reminder.text)` currently called inside these blocks — move it into `deliverReminderEvent` in `session-queue.ts:586`, inserting **before `q.enqueue(event)` at line 613**. Get the session name via `getSession(targetSid)?.name ?? ""`. **Imports for `session-queue.ts`:** (1) `getSession` is NOT currently imported — add `import { getSession } from "./session-manager.js";` to the import block. (2) `recordNonToolEvent` is exported from `src/trace-log.ts` — add `import { recordNonToolEvent } from "./trace-log.js";` to the import block.
- `src/reminder-state.ts:437` — `popActiveReminders` (add guard: skip `trigger === "last_received" || trigger === "last_sent"`)
- `src/reminder-state.ts:536` — `buildReminderEvent(reminder): ReminderEvent`
- `src/session-queue.ts:586` — **`deliverReminderEvent(targetSid, reminderEvent): boolean`** — enqueue function (handles `q.enqueue` + `notifyIfAllowed` + `notifyChannelSubscriber` + `notifySseSubscriber`)
- `src/reminder-state.ts:88-135` — existing `_sweepInterval` sweep (reference for new active-reminder sweep)
- `src/reminder-state.ts:102` — `SCHEDULE_NOTIFY_AHEAD_MS = 6_000` (remove in the LAST step)
- Test file: `src/reminder-state.test.ts`

**Note on SSE:** `deliverReminderEvent` currently calls `notifySseSubscriber` directly (ungated, line 616) — this is a pre-existing gap in the existing startup reminder path, NOT introduced by this task. It will be closed by 10-2305 which gates all `notifySseSubscriber` calls. In the interim, reminder delivery may produce one extra SSE write beyond the debounce guarantee. Do NOT fix the SSE gap here; flag it with a `// TODO 10-2305: notifySseSubscriber here is ungated — fixed when 10-2305 gates all SSE calls` comment.

## Design

### Enqueue mechanism

Use `deliverReminderEvent(sid, buildReminderEvent(reminder))` from `session-queue.ts`. Call this instead of returning the reminder in the dequeue loop.

### New time/active reminder sweep timer

Add a new periodic sweep in `src/reminder-state.ts` for time/active reminders:
- **Constant:** `ACTIVE_REMINDER_SWEEP_MS = 5_000` (5 s interval; same cadence as schedule sweep)
- **Tracking set:** `_activeSids: Set<number>` — sessions that have at least one active time/active reminder. Declare alongside `_scheduleSids` at `src/reminder-state.ts:96`: add `const _activeSids = new Set<number>();` on a new line immediately after line 96.
- **Registration:** add `_activeSids.add(sid)` in TWO places:
  1. In `addReminder` (`src/reminder-state.ts:229`): after `_reminders.set(sid, list)` at line 297 and before `return reminder;` at line 298, add: `if (reminder.state === "active") _activeSids.add(sid);` — registers only newly-created active reminders (those with `trigger === "time"` and `delay_seconds === 0`).
  2. In `promoteDeferred` (`src/reminder-state.ts:419`): **inside** the `if (r.trigger !== "schedule" && r.state === "deferred" && now >= ...)` block, after the `r.activated_at = now;` line and **before the closing `}` of that if block**, add `_activeSids.add(sid);` — registers deferred reminders that become active after their delay elapses.
- **Deregistration:** in the sweep callback body, after firing all pending reminders for a given `sid`, check `if (getActiveReminders(sid).length === 0) _activeSids.delete(sid)`. Also call the same check in `cancelReminder` (line 305) and `clearSessionReminders` (line 553) after removing a reminder.
- **Sweep callback:** every 5 s, for each `sid` in `_activeSids`:
  1. Guard: `if (isDequeueActive(sid)) continue;` — skip sessions where a dequeue is in flight; the in-loop path handles them. Add comment: `// Reminders do not interrupt active conversations. // Starvation (indefinite deferral during activity) is acceptable by design. §5-b`
  2. Call `popActiveReminders(sid)` and call `deliverReminderEvent(sid, buildReminderEvent(r))` for each result
  3. Deregister `sid` if no active reminders remain (see above)

**Import:** Add `isDequeueActive` to the existing import at `reminder-state.ts:16`. Change:
```ts
import { notifyIfAllowed } from "./tools/activity/file-state.js";
```
to:
```ts
import { notifyIfAllowed, isDequeueActive } from "./tools/activity/file-state.js";
```
(`isDequeueActive` is NOT already imported there — this is a required addition.) This replaces the `idleDuration >= REMINDER_IDLE_THRESHOLD_MS` check — the 60-second idle threshold was a dequeue-loop artifact for in-flight conversations; the sweep only runs for parked agents (`isDequeueActive = false`), making the threshold unnecessary.

### Bug 1 fix (`only_if_silent` dropped by `profile/import`)

In `src/tools/profile/import.ts`, the reminder Zod schema at lines 63-72 (inside `z.array(z.object({...}))`) is missing `only_if_silent`. Add:
```ts
only_if_silent: z.boolean().optional(),
```
to that `z.object({...})` block. `apply.ts` already reads `rd.only_if_silent` — no change needed there. This is the complete fix for this bug.

**Scope note:** The schema is also missing other fields (`trigger` variants `last_sent`, `last_received`, `schedule`; `mode`, `cron`, `tz`). These are **pre-existing gaps, explicitly out of scope for this task**. Do NOT add them here — they are deferred to a separate schema-completeness cleanup task.

### Bug 2 fix (event-triggered recurring over-fire)

Inside `popActiveReminders` in `src/reminder-state.ts:437`, the `fireable` filter uses `.filter()` (not a loop). Add the exclusion as additional conditions inside the existing `.filter()` predicate at lines 441-446. Replace:
```ts
const fireable = list.filter(r =>
  r.trigger !== "schedule" &&
  r.state === "active" &&
  !r.disabled &&
  !(r.sleep_until !== undefined && now < r.sleep_until),
);
```
with:
```ts
const fireable = list.filter(r =>
  r.trigger !== "schedule" &&
  r.trigger !== "last_received" &&  // §5-b: event-triggered; handled by event path only
  r.trigger !== "last_sent" &&      // §5-b: event-triggered; handled by event path only
  r.state === "active" &&
  !r.disabled &&
  !(r.sleep_until !== undefined && now < r.sleep_until),
);
```

The existing function is still exported (keep for backward compat with tests).

### Event-triggered reminders

Replace the in-loop `popFireableEventReminders` call sites in `dequeue.ts` with an eager call at enqueue time. Specifically, in `enqueueToSession` (line 278-288 in `session-queue.ts`), after `q.enqueue(event)` (line 284), add:

```ts
// §5-b: Fire event-triggered reminders eagerly when events arrive for parked agents.
if (!isDequeueActive(sid)) {
  for (const r of popFireableEventReminders(sid)) {
    deliverReminderEvent(sid, buildReminderEvent(r));
  }
}
```

**Imports confirmed:** `isDequeueActive` is already imported in `session-queue.ts` at line 22 — no new import needed. Add `popFireableEventReminders` and `buildReminderEvent` to the existing import from `"./reminder-state.js"` at line 20-21 if not already present. Note: `deliverReminderEvent` calls `q.enqueue(event)` directly (line 613, not via `enqueueToSession`), so there is **no recursion risk**.

**Scope note on other `q.enqueue` call sites:** `deliverServiceMessage`, `deliverReminderEvent`, and `routeMessage` all bypass `enqueueToSession` and call `q.enqueue` directly — they do NOT trigger event-triggered reminders. This is **intentional**: event-triggered reminders should only fire on inbound operator messages (the path through `enqueueToSession`), not on service messages, reminder echoes, or child-forwarded messages. Do NOT instrument the other call sites.

This means event-triggered reminders are enqueued synchronously alongside the triggering event — they arrive in the queue immediately after the trigger event, not in a separate loop iteration.

### Reminder ordering (decision B: messages-first)

Implement messages-first by modifying `dequeueBatchAny()` at `src/tools/dequeue.ts:274-276` to sort its return value before returning:
```ts
function dequeueBatchAny(): TimelineEvent[] {
  const batch = sq.dequeueBatch();
  // §5-b decision B: messages-first ordering — reminders yield to real messages.
  return batch.sort((a, b) => {
    const aR = a.event === "reminder" ? 1 : 0;
    const bR = b.event === "reminder" ? 1 : 0;
    return aR - bR; // stable: non-reminder before reminder, FIFO within each group
  });
}
```
Both call sites automatically receive sorted batches:
- First call site: `let batch = dequeueBatchAny()` at line 325 (immediate-batch return path)
- Second call site: `batch = dequeueBatchAny()` inside the `if (useVersionedWait)` block (the block that checks `if (useVersionedWait)` after capturing `wakeVersion` in the wait loop)

### Starvation (decision C: acceptable)

Add comment at the sweep idle check as noted above.

### Kick-ahead removal (decision D — LAST step)

Remove `SCHEDULE_NOTIFY_AHEAD_MS = 6_000` at `src/reminder-state.ts:102` and its usage. Keep the `waitMs` schedule term. LAST commit.

## Acceptance Criteria

Tests go in `src/reminder-state.test.ts` (reminder-state unit tests) and `src/session-queue.test.ts` (enqueue-path integration). Use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()`. For cross-module spies, use `vi.mock('./session-queue.js', ...)` or `vi.mock('./tools/activity/file-state.js', ...)` at the top of the test file as needed.

- [ ] **AC-8 (parked agent, time reminder)** — in `reminder-state.test.ts`: Add an active reminder (registered in `_activeSids`). Mock `isDequeueActive` to return `false` via `vi.mock('./tools/activity/file-state.js', () => ({ isDequeueActive: vi.fn().mockReturnValue(false), notifyIfAllowed: vi.fn() }))`. Mock `deliverReminderEvent` via `vi.mock('./session-queue.js', () => ({ deliverReminderEvent: vi.fn() }))`. Advance time via `vi.advanceTimersByTimeAsync(5_000)` (one 5 s sweep interval). Assert the `deliverReminderEvent` mock was called at least once with the correct sid. (Note: `notifyIfAllowed` is called inside the real `deliverReminderEvent` body — since `deliverReminderEvent` is mocked, do NOT assert `notifyIfAllowed` was called here; that chain is tested separately in 10-2305.)
- [ ] **AC-event (event-triggered reminder state test)** — in `reminder-state.test.ts`: Set a `last_received` reminder (non-recurring). Call `recordLastReceivedAt(sid, "operator", Date.now())` to simulate message receipt. Call `popFireableEventReminders(sid)` directly. Assert the reminder is returned (length 1, correct reminder). This validates the reminder becomes fireable on `last_received` update. **Integration verification** (grep AC): `grep -n "popFireableEventReminders" src/session-queue.ts` returns at least one match inside `enqueueToSession` — confirms the event-triggered path is wired. No automated unit test required for this integration point beyond the grep AC.
- [ ] **AC-9 (messages-first ordering)** — in `session-queue.test.ts`: Enqueue two messages and two reminders to a session using exported functions: call `deliverServiceMessage(sid, "message-1", "test")` and `deliverServiceMessage(sid, "message-2", "test")` for the messages; call `deliverReminderEvent(sid, buildReminderEvent(r1))` and `deliverReminderEvent(sid, buildReminderEvent(r2))` for the reminders (where `r1`, `r2` are valid `Reminder` objects). Call `dequeue` once with `max_wait: 1` (1 second). Assert the `dequeue` response's `updates` array contains all 4 events, with the two message events before the two reminder events (FIFO within each group). Assert `pending` is 0 after the call.
- [ ] **Starvation comment**: the two-line starvation comment is present in the sweep callback body at the `isDequeueActive` guard site (as specified in design).
- [ ] **Bug 2 fix**: a `recurring: true` + `last_received` reminder fires once via the event path, re-arms to "active", then is NOT re-fired by the time-based sweep. Test: set reminder, fire via event, advance `10_000` ms (2 sweep intervals) without new event, assert NOT re-delivered. Provide new event, assert delivered exactly once.
- [ ] **`popActiveReminders` guard**: Set a reminder with `trigger === "last_received"` and `state === "active"` (simulate the re-armed state). Call `popActiveReminders(sid)` directly. Assert it returns an empty array (reminder skipped by the guard).
- [ ] **Bug 1 fix**: Set a reminder with `trigger: "last_received"` and `only_if_silent: true` via `addReminder`. Export profile state (or serialize the reminder directly). Import it back via the `profile/import` code path. List reminders via `listReminders()`. Assert the re-imported reminder has `only_if_silent === true`. (Note: `only_if_silent` is only stored by `addReminder` when `trigger === "last_received"` — use that trigger in this test.)
- [ ] **Kick-ahead removed**: `SCHEDULE_NOTIFY_AHEAD_MS` and sweep usage removed. Test: parked agent + scheduled reminder → fires within ±200 ms of `next_fire_ms` without kick-ahead.
- [ ] `dequeue.ts` has zero calls to `popActiveReminders`, `popFireableEventReminders`, `popFireableScheduleReminders`. Verified by grep.
- [ ] `deliverReminderEvent` has `// TODO 10-2305` SSE comment.
- [ ] Updated `deliverReminderEvent` docstring to reflect it is no longer startup-only.
- [ ] All existing reminder tests pass.

## Out of Scope

- Making reminder ordering configurable per profile.
- Max-defer cap for starved reminders.
- `hasPendingUserContent` reminder counting (10-2303 TODO; wire if trivial).
- Deleting `pop*` exported function definitions (leave, add TODO if now unused).
- Fixing `deliverReminderEvent`'s ungated SSE call (10-2305 handles globally).

## Notes

- Should merge to `dev-7.10.0` after 10-2303.
- Kick-ahead removal is the LAST commit.
- 10-2305 has no hard dependency ordering on this task.

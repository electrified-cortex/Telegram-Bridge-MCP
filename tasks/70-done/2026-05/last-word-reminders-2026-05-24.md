# Last-sent and last-received reminders

**Captured:** 2026-05-24 (PT)
**Source:** operator voice msgs 60952, 60957, 60961, 60963, 60965, 60966, 60971, 60972, 60974, 60975, 60981, 60990, 60993, 60995 (high priority)
**Status:** Curator-stamped 2026-05-24 — operator-directed move to 40-queued per msg 60997. Overseer may still gate retroactively from queue.

---

## Conceptual model

Operator (msg 60995, FINAL): "They are separate. There's only two reminders. For now, as a prototype, there's last sent and there's last received."

Two **independent** reminder triggers. Each tracks its own kind of conversation event. They DO NOT share a clock; they DO NOT reset each other.

1. **`trigger: "last_sent"`** — fires N seconds after the session's most recent outbound `send`. Reset: any new outbound send. Receives do not reset it.
2. **`trigger: "last_received"`** — fires N seconds after the session's most recent qualifying inbound message. Reset: any new qualifying inbound. Sends do not reset it.

Operator explicitly accepted the edge case where `last_sent` may fire AFTER an operator reply has come in: that scenario indicates the agent received the reply but never followed up, which is a legitimate "yikes" state worth surfacing.

Both can coexist on the same session. Both default to PERSISTENT (re-arm after fire). Both can be set as ONE-OFF.

---

## Existing reminder triggers (for context, from `src/reminder-state.ts`)

| trigger | recurring | semantics |
| --- | --- | --- |
| `"time"` | `false` | one-off after N seconds |
| `"time"` | `true` | recurring; re-arms every N seconds |
| `"startup"` | n/a (delay 0) | fires on session start |

---

## New trigger 1: `"last_sent"`

### Reset trigger

Any successful outbound `send` from this session. Uses the ACTUAL send completion timestamp (e.g. for async voice/TTS, the moment the message lands in Telegram, not the moment `send` was called).

**Partial-failure rule:** `last_sent_at` updates ONLY on confirmed Telegram delivery (a `message_id` is returned). If the send initiates but Telegram delivery is rejected (e.g. TTS rendered but the API call to send the voice note fails), `last_sent_at` does NOT update. Treat the send as if it never happened for reminder-reset purposes.

### Fire condition

`delay_seconds` have elapsed since the most recent `last_sent_at` for this session, AND no newer send has happened.

### Behavior after firing

- **Persistent (default):** re-arms on next send. Same as recurring time-reminders.
- **One-off:** does not re-arm. Single fire per `reminder/set` call.

### Use case

"Agent posted something to the operator. After N minutes with no further send from agent, fire a reminder: did you follow up on your last message?"

This is INTENTIONALLY blind to whether the operator replied. If the operator did reply and the agent ignored it, this reminder is the safety net.

---

## New trigger 2: `"last_received"`

### Reset trigger

Any qualifying inbound message to this session (per `mode`). Uses the server-side enqueue timestamp, not the `dequeue` consumption timestamp.

**Exclusion symmetry:** the same exclusion set that gates a `last_received` FIRE (service messages, reminder fires, reactions, ack/approve tickets) also gates `last_received_at` RESET. A reminder fire arriving in the queue does NOT reset the clock — preserving loop-prevention from both ends.

**Batch enqueue semantics:** when multiple qualifying inbound messages are enqueued close together (a batch), `last_received_at` = max(enqueue timestamps of qualifying messages in the batch). Most recent arrival wins.

### `mode` parameter

| mode | qualifying inbound |
| --- | --- |
| `"all"` (default) | any inbound: operator messages, DMs from other sessions |
| `"operator"` | only inbound from operator (excludes inter-session DMs) |

Both modes EXCLUDE: service messages, reminder fires, reactions, ack/approve tickets.

### Fire condition

`delay_seconds` have elapsed since the most recent qualifying inbound, AND no newer qualifying inbound has happened.

### Behavior after firing

- **Persistent (default):** re-arms on next qualifying inbound.
- **One-off:** does not re-arm.

### Use case

"Operator (or peer) sent the agent a message. After N minutes with no further inbound, fire: the conversation has gone quiet on the inbound side."

---

## Loop-prevention

Reminders never reset either timer:
- A `last_sent` fire is an internal event, not a `send`. It does not reset `last_sent_at`.
- A `last_received` fire produces an inbound event to the agent's queue, but reminder fires are explicitly excluded from the qualifying-inbound set. It does not reset `last_received_at`.

No infinite re-fire loop possible. After firing (persistent), the next actual event of the matching kind re-arms the timer; until that event, the reminder waits.

---

## Reconnect catch-up

If the session reconnects after a gap during which the reminder would have fired (e.g. the bridge was down or the session was disconnected), the reminder fires IMMEDIATELY on reconnect when `elapsed_seconds_since_last_event > delay_seconds`. Same semantics as `trigger: "startup"` reminders. Persistent reminders subsequently re-arm on the next matching event.

## Persistence + profile-save

- Default `recurring`-style behavior: reminder re-arms after each fire on the next matching event.
- One-off mode: pass `recurring: false` in the `reminder/set` call.
- Last-sent and last-received reminders MUST be saveable in profiles (alongside existing reminders) via `profile/save` / `profile/load`.

---

## Acceptance criteria

- **AC1**: `action({ type: 'reminder/set', trigger: 'last_sent', delay_seconds: 180, text: '...' })` registers a persistent last_sent reminder.
- **AC2**: Any successful `send` from this session updates `last_sent_at` to the actual completion timestamp.
- **AC3**: A persistent `last_sent` reminder fires `delay_seconds` after `last_sent_at`, then re-arms — next send updates `last_sent_at` again, cycle continues.
- **AC4**: `last_sent` with `recurring: false` fires exactly once after the first matching send, then does not re-arm.
- **AC5**: Inbound messages do NOT reset `last_sent_at`. A `last_sent` reminder can fire after the operator has already replied (intentional, per operator).
- **AC6**: `action({ type: 'reminder/set', trigger: 'last_received', mode: 'all', delay_seconds: 300, text: '...' })` registers a last_received reminder.
- **AC7**: `mode: "all"` qualifying inbound = operator + inter-session DMs.
- **AC8**: `mode: "operator"` qualifying inbound = operator only.
- **AC9**: Service messages, reminder fires, reactions, ack/approve tickets never qualify under either mode.
- **AC10**: A persistent `last_received` reminder fires `delay_seconds` after the qualifying-inbound timestamp, then re-arms.
- **AC11**: `last_received` with `recurring: false` fires once then does not re-arm.
- **AC12**: Outbound sends do NOT reset `last_received_at`.
- **AC13**: Multiple last-sent / last-received reminders (different delays) coexist independently on the same session.
- **AC14**: Both triggers persist across compaction and session reconnect (same as existing reminders).
- **AC15**: Both triggers are included in `profile/save` and restored by `profile/load`.
- **AC16**: `reminder/list` returns last_sent and last_received reminders with current `time_since_last_*_seconds` field per type.

---

## Open questions (for operator)

- **OQ1**: `reminder/sleep <until>` on these — pause firing while sleeping but keep tracking the timestamps? *Lean: yes.*
- **OQ2**: For `last_received` timestamp, use server-side enqueue (so an un-dequeueing agent still gets clean tracking)? *Lean: yes.*

---

## Delegation

- Spec author: Curator (this doc)
- Vet + queue: Overseer
- Implementation: Worker pod with TMCP context

## Files in scope

- `src/reminder-state.ts` — add `"last_sent"` and `"last_received"` to trigger union; add optional `mode` field for last_received; per-session timestamp tracking (`last_sent_at`, `last_received_at_by_mode`)
- `src/session-queue.ts` — hook outbound send-completion (capture actual-send time) + inbound enqueue path (capture qualifying-event time)
- `src/tools/reminder/set.ts` — accept new trigger values + optional `mode` field
- `src/tools/profile/save.ts` + `profile/load.ts` — include new reminders in profile snapshots
- `src/reminder-state.test.ts` — test suites for both triggers, persistence + one-off variants, mode behavior, loop-prevention
- `src/tools/action.ts` — surface schema updates

---

## Priority

HIGH per operator. Operator: "Let's make it happen. It's high pry."

---

## Overseer review

- **Reviewer:** Overseer
- **Date:** 2026-05-24
- **Verdict:** REVISE
- **Review type:** adversarial-swarm (Engineer + Devil's Advocate + Simplicity Lover, 3 rounds)

**Checked:** ACs binary and testable (all 16 pass), scope clear and bounded, delegation correct, loop-prevention logic sound, trigger independence sound, mode parameter operator-directed (not cutting).

**Bounce — 4 spec gaps to fill before re-gate:**

1. **Exclusion set applies to reset, not just fire** — Add explicit statement: "The same exclusion set that gates a `last_received` fire (no service messages, reminder fires, reactions, ack/approve tickets) also gates `last_received_at` reset. A reminder fire arriving in the dequeue queue does NOT reset the clock."

2. **Max-of-batch enqueue semantics** — Add explicit statement: "When multiple qualifying inbound messages are batched (enqueued close together), `last_received_at` = max(enqueue timestamps of qualifying messages in the batch). Most recent arrival wins."

3. **Async TTS partial failure** — Clarify: if a send is initiated but Telegram delivery fails (TTS completes, delivery rejected), does `last_sent_at` update? Suggest: only update on confirmed Telegram delivery (message_id received). Partial failure = no update.

4. **Catch-up semantics on reconnect** — Clarify: if session reconnects after a gap during which the timer would have fired, does the reminder fire immediately on reconnect, or is the clock reset to delay_seconds from now? Suggest: fire immediately if elapsed > delay_seconds (same as startup reminders).

**Not checked:** technical correctness of test infrastructure, specific TypeScript implementation paths.


---

## Claimant

Foreman — 2026-05-24


---

## Verification

- **Verdict:** APPROVED
- **Date:** 2026-05-25
- **Verifier:** task-verification sub-agent (a824c08fb60d2c092)
- **Test gate:** 3242 tests, 142 test files — all passed
- **AC coverage:** AC1–AC16 all CONFIRMED with direct code citations
- **Notes:** Clean worktree (only untracked .temp/ scratch). Partial-failure TTS gate (AC2), reconnect fire-immediately (AC14), and loop-prevention (AC9) all verified in code and tests.

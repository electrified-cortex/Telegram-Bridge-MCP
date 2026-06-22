---
id: draft-reminder-only-if-silent-drop
title: "Bug: profile/import drops only_if_silent; recurring last_received fires too often"
created: 2026-06-10
status: draft
priority: 10
type: bug
source: S-IM 2026-06-10
---

# Reminder bug — profile/import only_if_silent drop + recurring semantics

## Source

Reported via S-IM on 2026-06-10.
Affected: a 2-minute last_received reminder (id: e0ad095a03a4cbfa, now disabled).

## Bug 1 — profile/import drops only_if_silent

`profile/import` (or the profile.json loader) silently drops the `only_if_silent` field
on reminders. Live state via `reminder/list` shows `only_if_silent: false` even when
`profile.json` sets `only_if_silent: true`.

Either: (a) field is ignored during import, or (b) schema mismatch between profile.json
format and import parser.

Reproduce: set a reminder in profile.json with `only_if_silent: true`, import, then
call `reminder/list` and inspect the live state.

## Bug 2 — recurring last_received fires too many times

`recurring: true` + `last_received` trigger: fires every `delay_seconds` while the trigger
state persists. Expected behavior per Pilot directive 4719: should fire ONCE per last_received
event, not repeatedly.

The "once-per-event" semantic (fire once after the triggering event, then wait for the next
qualifying event) conflicts with the current `recurring: true` implementation which re-arms
on timer expiry.

## Impact

Both bugs compound: a recurring reminder that should fire once (silently when agent has
already replied) instead fires repeatedly and ignores the only_if_silent gate.
Workaround: reminder disabled by BT-7274.

## Notes

- Not yet stamped — needs adversarial review before queuing
- Relates to 7.10 reminder unification (§5-b of notification-wake-contract-SPEC.md)
- The §5-b unification (reminders enter the queue) may subsume or interact with these fixes
- Suggest reviewing alongside 7.10 spec before assigning a standalone worker

## Curator direction (2026-06-10)

Fold into 7.10.0 §5-b (reminders-into-queue) work — one worker handles both the queue
unification AND the only_if_silent / recurring semantic fixes together. Do not assign a
standalone worker. Hold until A-D decisions land and 7.10.0 spec is finalized.

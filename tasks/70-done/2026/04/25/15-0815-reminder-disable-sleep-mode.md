---
id: 15-0815
title: Reminder disable / sleep mode — mute without delete
status: draft
priority: 15
origin: operator voice 2026-04-24 msg 41969
---

# Reminder disable / sleep mode — mute without delete

## Problem

Today, graceful fleet wrap required Overseer to stop auto-spawning workers. Her auto-spawn is driven by the fleet-health reminder firing + her scaling rule. To silence, she had to `reminder/cancel` each one — destructive; she'd need to recreate them for resume. Alternative: delete the whole profile. Too heavy.

What's missing: a way to PAUSE a reminder without losing its configuration.

## Proposed

Add two new reminder actions:

- `action(type: "reminder/disable", id: "<reminder-id>")` — reminder keeps its config (text, interval, recurring flag) but stops firing. Returns to inactive state.
- `action(type: "reminder/enable", id: "<reminder-id>")` — re-activates a disabled reminder.

`sleep` variant (distinct from disable):

- `action(type: "reminder/sleep", id: "<reminder-id>", until: "<ISO-8601 datetime>")` — sleep until the given datetime. On every reminder tick, the bridge checks `now >= until`; if still in the future, skip firing. When `now >= until`, resume normal firing.
- **Sleep value is a datetime, not a duration.** Durations would keep running post-compaction; a datetime is the cleanest check.
- To wake early: `reminder/sleep` again with a past datetime (sets sleep to "already expired" — reminder resumes).
- "Forever" = pass a far-future date (e.g., year 9999). No special sentinel values needed.
- **Key semantic:** sleep is TRANSIENT — the sleep state does NOT persist across session end or `profile/save`. Profile stores reminder config (text, interval, recurring) only; the `until` field is memory-only. Operator 2026-04-24: "the nice thing about sleep is that information wouldn't get stored; if they saved their profile, they wouldn't lose their reminder, and that sleep info just wouldn't go along with it."
- Contrast with `disable`, which persists across session + profile-save.

## Requirements

- Disabled reminders still listed by `reminder/list` with a `disabled: true` flag (or `state: "sleeping"`).
- `reminder/disable` is idempotent.
- Sleep wakeup happens server-side — agent doesn't have to poll.
- Disabled state survives session restart (reminder is still in the profile; it just has a suspended flag).

## Acceptance

- [ ] `reminder/disable` action implemented; disabled reminders don't fire until re-enabled.
- [ ] `reminder/enable` re-activates without needing to recreate.
- [ ] `reminder/sleep` (if included) auto-wakes at the specified time.
- [ ] `reminder/list` shows state (active / disabled / sleeping).
- [ ] Tests cover disable-then-enable round-trip + sleep wakeup.

## Don'ts

- Don't destroy reminder config on disable.
- Don't require agent to track disabled-state client-side. Server owns state.
- Don't let disabled reminders fire due to race conditions at disable time.

## Related

- `.agents/tasks/10-drafts/curator-only/15-0814-overseer-wrap-mode-state.md` — fleet wrap-mode state (higher-level concept). This reminder/disable is a building block for that.

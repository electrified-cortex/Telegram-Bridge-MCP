---
id: "10-0877"
title: "Revert onboarding service messages + help docs to Monitor-as-augment framing"
type: docs
priority: 20
status: draft
created: 2026-05-05
repo: Telegram MCP
delegation: Worker
---

# Revert onboarding to Monitor-as-augment framing

## Operator directive (2026-05-05)

> "We need to revise this whole process to kind of be more like it was. Make how was it at 7.3 and the basic gist of how dequeuing works. And now we're introducing this as part of the startup. When you get the startup, you actually tell the agent — you instruct the agent — if you can, monitor, call this to monitor a file. But we still tell the same story about, to stay in the loop, call dequeue. You don't want to remove that primary responsibility that dequeuing is the way to get through. We're just adding this as an augment to replace the Telegram loop guard pattern, which really kind of sucked."

Prior to 2026-05-04 (TMCP 7.3-era), the canonical loop story was:

> "Dequeue is THE way to receive messages. Loop on it; long-poll handles delivery."

Last 24-48 hours of changes shifted the story toward "Monitor is the wake mechanism" in onboarding text and hint phrasing. Operator wants this reverted: Monitor is optional, dequeue is primary.

## Scope

Audit and update:

1. **Onboarding service messages** that fire post-`session/start` — anything that frames Monitor as the wake/delivery mechanism gets re-worded. Keep: a single optional-augment note that says "if your harness has Monitor (or equivalent watcher), you can opt into the activity-file pattern via `action(type: 'activity/file/create')` to reduce idle-poll overhead. Otherwise, long-poll `dequeue` (default `max_wait: 300`) is the standard mechanism."
2. **`behavior_nudge_*` and `onboarding_*` events** — review wording for any "Monitor as primary" implications. Replace with augment language.
3. **`help` topics** related to the loop / dequeue / activity-file — same re-framing.
4. **Quick-start / startup help text** — make sure the first-pass story is dequeue-primary.
5. **Per 10-0871** (sibling task, also touching the activity/file help topic): coordinate so both edits land aligned.

## Acceptance criteria

- A fresh agent reading the post-startup service messages comes away with: dequeue is THE way to receive messages, long-poll is normal, Monitor is optional.
- No service message reads as "use Monitor to receive messages."
- The activity-file / Monitor pattern is presented as a single opt-in augment with a one-line callout, not as a primary mechanism.
- Help topic for `activity/file` reflects the same framing (per 10-0871).
- Existing dequeue help topic is unchanged in intent — verify it still leads with "dequeue is the loop primitive."

## Out of scope

- Removing the activity-file feature itself.
- Code changes to dequeue or activity-file behavior (those are 10-0875 / 10-0876).
- The HTTP `/dequeue` endpoint (that's 10-0873).

## Related

- **10-0871** — activity/file help topic (already updated with Monitor-as-augment framing in description).
- **10-0875** — remove ACTIVITY_FILE_DEQUEUE_CAP_S.
- **10-0876** — major debounce on activity-file mtime touches.
- Curator memory `feedback_dequeue_long_poll_primary_monitor_nudge.md`.
- Audit findings: `tasks/00-ideas/audit-monitor-last-24h-2026-05-05.md`.

## Dispatch

Worker-shippable. Sonnet-class — wording needs care to land "optional augment" without confusing readers who relied on the prior framing.

## Bailout

90 min. If the onboarding-message catalog is broader than expected (more than ~6 messages to revise), file a continuation task and surface the partial list.

## Completion

- Branch: `10-0877` merged to `release/7.4`, back-merged to `dev`
- Commit: `82d56dfe` — added ONBOARDING_LOOP_PATTERN service message, wired into start.ts both paths, appended help/start.md Dequeue Loop section
- Framing: dequeue is primary heartbeat; activity-file is "Optional augment"
- Worker: Worker

## Verification Stamp

**Verdict:** APPROVED
**Date:** 2026-05-05
**Criteria:** 5/5 passed
**Evidence:** New `ONBOARDING_LOOP_PATTERN` message leads with dequeue as heartbeat, explicitly labels activity-file as "Optional augment, not a replacement for dequeue." Fired in both single-session and multi-session paths in start.ts. `docs/help/start.md` Dequeue Loop section appended with opt-in callout. No Monitor-as-primary framing found anywhere. `docs/help/dequeue.md` unchanged.

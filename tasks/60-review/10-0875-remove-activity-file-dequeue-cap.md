---
id: "10-0875"
title: "Remove activity-file dequeue cap — keep default 300s"
type: bug
priority: 20
status: draft
created: 2026-05-05
repo: Telegram MCP
delegation: Worker
---

# Remove activity-file dequeue cap (ACTIVITY_FILE_DEQUEUE_CAP_S = 5)

## Operator framing (2026-05-05)

> "We need to remove the feature that says when calling `activity/file/create` there was something in there that reset the dequeue max_wait to like 5 seconds or something. Let's just remove any of that custom max_wait stuff and keep things at the default of 300 seconds. If somebody wants to reduce it down to one minute, the cost is token churn — the longer the dequeue is waiting, the less token churn you're going to have."

## Where the cap lives

`src/tools/activity/file-state.ts:55`:

```ts
/** Dequeue override cap when activity/file is active (seconds). */
export const ACTIVITY_FILE_DEQUEUE_CAP_S = 5;
```

This was added by the 50-0868 task (commit `0794447d`, 2026-05-03) — "activity/file/create applies a TEMPORARY override; activity/file/delete clears it." Premise was that Monitor would wake the agent so dequeue should return fast. New framing (2026-05-05): Monitor is just a nudge replacing the loop guard; dequeue stays primary; long-poll is the win because it cuts turn count.

## What to remove

1. `ACTIVITY_FILE_DEQUEUE_CAP_S` constant in `file-state.ts`.
2. All call sites that consult it (likely in `dequeue.ts` and possibly `session-manager.ts` — search and remove).
3. Any test that asserts the cap.
4. Updated docs in 50-0868 task notes — mark this behavior reverted.

## Acceptance criteria

- `dequeue` honors session's `dequeueDefault` (or server default 300s) regardless of whether an activity-file is registered.
- Activity-file create/delete no longer adjusts dequeue timeout.
- Existing test for the cap is removed; no regression in other dequeue tests.
- Help/topic text and onboarding service messages don't reference the cap.

## Out of scope

- Changing the default 300s server setting.
- Removing the `profile/dequeue-default` user-settable timeout (that stays — operator can still customize).
- Anything about Monitor or activity-file behavior beyond this cap.

## Related

- 50-0868 (introduced the cap).
- 10-0872 (superseded — the spoon-feed framing depended on this cap; both go together).
- Curator memory `feedback_dequeue_long_poll_primary_monitor_nudge.md`.

## Dispatch

Worker-shippable. Haiku-class — small, mechanical removal. Tests: existing cap test deleted; existing default-300 test should already cover the keep-default behavior.

## Bailout

If removing the cap surfaces a hidden dependency (e.g. some integration test silently relied on the 5s cap to make tests fast), escalate to Curator. 90 min cap.

## Completion

- Branch: `10-0875` merged to `release/7.4`, back-merged to `dev`
- Commit: `ed55f066` — removed `ACTIVITY_FILE_DEQUEUE_CAP_S` constant and its import+application block in dequeue.ts
- `dequeue` now honors session's `dequeueDefault` (300s fallback) regardless of activity-file registration
- Tests: cap test removed; no residual source references
- Worker: Worker (SID 2, Copilot)

## Verification Stamp

**Verdict:** APPROVED
**Date:** 2026-05-05
**Criteria:** 4/4 passed
**Evidence:** `ACTIVITY_FILE_DEQUEUE_CAP_S` fully removed from `file-state.ts` and `dequeue.ts`. No residual `src/` references. `effectiveTimeout` resolves purely from explicit param or `getDequeueDefault`. No cap test remains. Help docs contain no mention of 5s cap.

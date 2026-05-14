---
id: "10-0874"
title: "Disable health-check prompts while session has an active activity-file watcher"
type: feature
priority: 30
status: draft
created: 2026-05-05
repo: Telegram MCP
delegation: Worker
target_branch: dev
status: completed
claimant: foreman
claimed_at: 2026-05-14T23:16:00Z
worktree: .foreman-pod/.worktrees/10-0874
spawn_task: bse5gq7hc
---

# Disable health-check while activity-monitor is active

## Operator framing (2026-05-05)

> "It's good to see that the health check works, but I think we should disable it when an activity monitor is active. Because it's kind of misleading, right? The person that uses activity monitor will be a little bit frustrated with that."

Health-check prompts (`hc_wait` callback buttons) are sent on long silence to verify the session is alive. When a session has an active activity-file watcher, presence is *already* maintained by the watcher's mtime-driven wakes — the health-check is redundant and confusing.

## Approach

When TMCP would otherwise schedule/emit a health-check prompt for a session, first check whether that session has an active activity file (was provisioned via `action(type: 'activity/file/create')` and the file still exists / is still being touched). If yes, skip the health-check.

State to consult:

- Session has an entry in the activity-file registry (the bridge already manages these per-session per the cleanup-on-close behavior).
- File still exists on disk.

Optional: also gate by recent-mtime — if the activity file hasn't been touched in N minutes (longer than expected event cadence), maybe TMCP isn't actually delivering events to it, and a health-check is appropriate.

## Acceptance criteria

- A session with an active activity-file does NOT receive `pending_approval`-style health-check buttons during normal idle silence.
- A session WITHOUT an activity-file continues to receive health-checks as today.
- Closing the activity-file (session/close cleanup, manual delete) re-enables health-checks for that session.

## Out of scope

- Removing the health-check feature entirely.
- Watcher-side improvements (those are 10-0872 / 10-0873).

## Dispatch

Worker-shippable. Haiku-class — small conditional in the health-check scheduler. Touch points likely in TMCP's reminder / health-check module + the activity-file registry.

## Bailout

If the activity-file registry doesn't currently track active state in a way the health-check scheduler can read, escalate to Curator — may need a small registry extension first.

## Related

- 10-0872 (watcher pre-drains dequeue)
- 10-0873 (HTTP dequeue endpoint)
- Prior session: activity-file create / cleanup behavior (50-0868 c203b9f3 on dev)

## Verification

**Verdict:** APPROVED
**Date:** 2026-05-14
**Verifier:** Dispatch sub-agent (fresh-eyes, read-only)
**Cherry-pick commit:** `ad886399` on `dev`

All 3 acceptance criteria CONFIRMED:
- AC1: Session with active activity-file skips health-check — guard at `health-check.ts:237-238` uses `getActivityFile(sid)` + `existsSync(filePath)`, continuing past `_flaggedSids.add`. Test: `health-check.test.ts:683-692`.
- AC2: Session without activity-file receives health-checks unchanged — `getActivityFile` returns `undefined`, guard not taken. Test: `health-check.test.ts:694-703`.
- AC3: Deleted file re-enables health-check — `existsSync` returns false → guard not taken. Test: `health-check.test.ts:705-715`.

38/38 tests pass. Cherry-pick avoided incidental create.ts regression (branch was cut before 10-0897 hint-fix landed on dev).

---
id: "30-0894"
title: "service message: post-compact monitor recovery hint"
type: feature
priority: 30
created: 2026-05-14
delegation: Worker
target_branch: dev
---

# 30-0894 — service message: post-compact monitor recovery hint

## Context

Activity-file monitors don't survive context compaction — the bash watcher process the agent armed before compact stays alive at the OS level, but the agent's harness reference to it (the Monitor task ID) is lost. After compact, the agent needs to re-arm a fresh monitor pointing at the same activity file. Today this is implicit: agents are supposed to know via the `telegram-participation` skill or the `recovery.md` context. They often don't (or forget), and go silent.

If TMCP correlates two signals it already has — a compaction event for an agent + an active activity-file registered for that agent — it can emit a targeted service message on the next dequeue: "Looks like you compacted. Your activity file is at <path>. Re-arm your monitor."

## Acceptance criteria

Trigger combination (both must be true at the moment of the compaction event):

1. TMCP receives a `compacting` event for an agent (already detected — same source as chat-history breadcrumb).
2. That agent has an `activity-file` currently registered.

When both conditions hold, TMCP queues a `service_message` (`event_type: "post_compact_monitor_recovery"`) for that agent's session, delivered on the next `dequeue`. Payload includes:

- The active activity-file path (so the agent can re-arm without calling `activity/file/get`).
- One-line hint: "Looks like you compacted. Re-arm your activity-file monitor on this path."

Emit ONCE per compaction event (don't spam every dequeue). If no activity-file is registered at compact time, do not queue anything.
## Out of scope

- Auto-reconnection (TMCP can't arm a monitor on the agent's behalf — only the agent can).
- Compaction events for chat history (separate concern).

## Source

- Operator request 2026-05-15T00:35 UTC: "if there's a monitor file active and we got a compaction event, we send them a service message... 'you probably lost your monitor, and we need to reconnect to this file.'"
- Related: companion to 30-0891 (activity-file recovery on file-deleted) and 30-0892 (bundled monitor script).

## Completion

Added `POST_COMPACT_MONITOR_RECOVERY` to `src/service-messages.ts`. Wired in `src/event-endpoint.ts`: on `compacting` event, if `getActivityFile(sid)` returns a value, calls `deliverServiceMessage` with path + hint text. 7 new tests (3023 total pass). Commit `f17ff694` on branch `30-0894`.

## Verification

APPROVED — 2026-05-15. All 4 criteria confirmed: trigger condition correct, payload has path + hint, once-per-event (queue consumed on dequeue), no-activity-file guard tested. Negative tests for `compacted`/`startup`/`stopped` events confirmed. Cherry-picked as `2945b209` onto `dev`.

Sealed-By: foreman

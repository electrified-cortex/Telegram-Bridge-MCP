---
created: 2026-06-20
status: draft
priority: 10
source: operator voice (76197, 2026-06-20) — "issue last night, efficiency in dequeuing and notification"
repo: electrified-cortex/Telegram-Bridge-MCP
type: Epic
agent_type: Worker
model_class: sonnet-class
---

# Epic 10-3020 — TMCP Efficiency: Dequeue + Notification

## Context

Operator flagged an efficiency issue surfaced in a real session the night of 2026-06-19.
Root cause relates to TMCP dequeuing and SSE notification patterns — agents receiving
unnecessary wakeups, phantom notifies, or inefficient loop patterns that burn tokens.

Known related items:
- Orphan staged change in `src/session-queue.ts`: extends `isSilentEvent` to suppress
  `agent_event` SSE notifications (alongside existing `behavior_nudge` suppression)
- Dequeue runaway guard (task 10-0011, stash@{0}) — prevents looping runaway on empty queue

## Objective

Identify, catalog, and fix all efficiency gaps in TMCP's dequeue and notification
pipeline. Goal: agents wake only on real actionable events; no phantom wakes; no
runaway loops.

## Audit

Background audit agent dispatched 2026-06-20. Findings will populate sub-tasks below.

## Audit findings summary (2026-06-20)

Audit conducted by background agent (abd67ab1210375674) against branch `dev` HEAD `dd803bcc`.

| # | Sev | File | Issue | Sub-task |
|---|-----|------|-------|----------|
| 1 | HIGH | session-queue.ts:607–609 | `agent_event` SSE suppression — staged, not committed | commit orphan staged change (lint fix + version bump) |
| 2 | HIGH | session-queue.ts:613 | `notifyChannelSubscriber` not gated on `isSilentEvent` | 10-3021 |
| 3 | HIGH | dequeue.ts:36–79 | Runaway dequeue guard in `dev`, not merged to `master` | 10-0011 (existing) |
| 4 | LOW | dequeue.ts:332–335 | `timeout=0` debounce non-release — intentional | No action needed |
| 5 | MED | file-state.ts:450–454 | Re-notify timer skips reminder-only queues (§5-b gap) | 10-3022 |
| 6 | LOW | channel.ts:150 | `flushPendingChannelNotify` dead export (unwired) | 10-3023 |
| 7 | LOW | temporal-queue.ts:184 | `peekCategories` O(N) drain-re-enqueue | 10-3024 |
| 8 | LOW | dequeue.ts:195–241 | Child onboarding msgs fire before `setDequeueActive` | 10-3025 |
| 9 | LOW | dequeue.ts:431–437 | Concurrent dequeue refcount gap — documented | Future work |

## Sub-tasks

- **10-0011** (existing queued) — dequeue runaway guard PR
- **10-3021** — `notifyChannelSubscriber` isSilentEvent guard (HIGH)
- **10-3022** — re-notify timer §5-b reminder inclusion (MEDIUM)
- **10-3023** — wire `flushPendingChannelNotify` at timeout exit (LOW)
- **10-3024** — `peekCategories` O(N) optimization (LOW, optional)
- **10-3025** — child onboarding `setDequeueActive` ordering (LOW)

## Acceptance criteria (epic-level)

1. Agent wakeup rate (SSE notifies per real operator message) documented before and after.
2. All identified phantom notify sources resolved.
3. Dequeue runaway guard active (task 10-0011 merged).
4. `agent_event` suppression committed (orphan staged change resolved).
5. No regression: real messages still deliver within 2s of send.

## Delegation

Epic owner: Overseer (routing) / Executor: Worker / Reviewer: Curator

## Notes

- The operator characterized this as an epic — sub-tasks should be filed individually
  after audit, gated, and dispatched to TMCP foreman.
- "Endless work" and "stay hot" signals from operator suggest ongoing engagement.


---
_Closed 2026-06-26 by task-board audit — shipped/complete (or v6 historical); moved from active lane to 70-done._

**Signed-off-by:** Claude Opus 4.8 — closure verified via task-board audit (subagent-assisted) against `src/` + `git log` on 2026-06-26.

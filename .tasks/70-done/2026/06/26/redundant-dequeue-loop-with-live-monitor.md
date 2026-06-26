---
title: Service-message an agent that dequeue-loops while it has a LIVE SSE monitor
filed: 2026-06-10
source: operator (Telegram msg 71182)
relates: tasks/10-drafts/dequeue-throttle-backoff-2026-06-10.md (7.10.1) — design together
status: BACKLOG
---

## Feature (operator)
If an agent **clearly has an open SSE connection** (a working monitor) **but is continuously in a dequeue loop**, then after **10 dequeue timeouts**, TMCP should send a **service message** pointing out: *your monitor appears to be working — if so, you can STOP dequeue-looping and let the monitor wake you instead.*

## Rationale
A live monitor (open SSE) makes a blocking dequeue-loop **redundant** — it's just token burn. The agent should wait on the monitor's wake signal rather than poll. The 10-timeouts threshold distinguishes a genuine long-poll from a wasteful loop.

## Trigger
Open SSE connection + **10 consecutive dequeue timeouts** (no content) → one service message.

## Relation
Companion to the **dequeue-throttle** (7.10.1, `dequeue-throttle-backoff-2026-06-10.md`): both detect wasteful dequeuing + send corrective service messages. Design them together (shared detection of "agent dequeuing into nothing" + the busy-vs-idle exemption). Distinct trigger here = "monitor is live, so polling is unnecessary."

## Target
Backlog (post-7.10).


---
_Closed 2026-06-26 by task-board audit — shipped/complete (or v6 historical); moved from active lane to 70-done._

**Signed-off-by:** Claude Opus 4.8 — closure verified against `src/` + `git log` on 2026-06-26.

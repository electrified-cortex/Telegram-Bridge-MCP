---
id: "50-0865"
title: "Bridge auto-terminate for stuck sessions (no recovery after N unhealthy events)"
type: task
priority: 50
status: queued
created: 2026-05-04
repo: Telegram MCP
delegation: Worker
depends_on: []
---

# Bridge auto-terminate for stuck sessions

## Background

From 2026-05-03 Overseer wedge postmortem (5-alarm incident).

The TMCP health-watcher correctly identified Overseer as unhealthy at
18:36:52 and again at 18:52:52. Auto-recovery worked the first time
(18:37:53). The second unhealthy event NEVER recovered. Same pattern
on Worker 2: cycled unhealthy/recovered for ~2 hours, then stuck
unhealthy at 21:10:53 with no further auto-recovery.

The bridge has no escalation path when auto-recovery itself stalls.
A session can sit "unhealthy" indefinitely while the operator and
peers are unaware that recovery has given up.

## Goal

When a session has been unhealthy for >N consecutive checks (or
>M minutes) without any successful recovery, the bridge:

1. Marks the session as `terminally_stuck` (distinct state from
   `unhealthy`).
2. Notifies the governor via a service event.
3. Optionally force-closes the session and emits a `session_closed`
   event so peers stop waiting.

## Procedure

1. Read `service/health.ts` (or wherever the health-watcher lives) to
   understand current cycle.
2. Add a "consecutive unhealthy" counter per SID.
3. After threshold N (proposal: 3 cycles, ~3 minutes), emit
   `agent_event` with `kind: terminally_stuck`.
4. After threshold M (proposal: 5 cycles or 10 minutes), force-close
   the session and emit `session_closed`.
5. Thresholds tunable via env vars or config.

## Acceptance criteria

- New service event `terminally_stuck` defined and documented.
- Force-close path exercised in unit test (mock health-watcher with
  failing recovery).
- Governor receives both events and can be observed in dequeue.
- Tunable thresholds via config (no magic numbers).

## Out of scope

- TTS render timeout (separate task: 50-0866).
- Curator-side peer-liveness alarm (separate task in .agents repo).

## Dispatch

Worker. Sonnet for the design + implementation.

## Bailout

Hard cap 3 hours. 15-min progress heartbeats to Curator. If
existing health-watcher architecture doesn't support per-SID state,
surface — don't graft a separate state machine.

## Related

- `agents/curator/memory/projects/2026-05-03-overseer-wedge-postmortem.md`
- 50-0866 (TTS timeout) — sibling task.
- Curator `peer-liveness alarm` task (in .agents/tasks/) — sibling.

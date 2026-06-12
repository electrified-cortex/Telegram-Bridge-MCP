---
id: "50-0865"
title: "Bridge auto-terminate for stuck sessions — KILLED 2026-05-04"
type: task
priority: 50
status: killed
created: 2026-05-04
killed: 2026-05-04
repo: Telegram MCP
delegation: Worker
depends_on: []
---

## KILLED 2026-05-04 by operator

Operator: "This story is bogus. There should be no auto-terminate
stuck sessions. Because how is a stuck session determined?"

Heuristic ("N consecutive unhealthy cycles") cannot reliably
distinguish a wedged session from an agent in a long inference
call. With `50-0868` (activity/file feature) coming, peer-liveness
becomes directly observable — auto-terminate becomes either
redundant or its trigger gets a cleaner basis.

Branch `50-0865-bridge-auto-terminate-stuck-sessions` (head
`57c0dcf5`) NOT to be merged. Force-delete after worktree removal.

Original spec retained below for reference, but DO NOT IMPLEMENT.

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

## Completion

Completed by Worker 3 (SID 9). Commit `57c0dcf5` on branch
`50-0865-bridge-auto-terminate-stuck-sessions`.

### What was done

- **`src/health-check.ts`**: Added `_consecutiveUnhealthyCounts: Map<number, number>` module
  state tracking consecutive unhealthy ticks per SID. When a flagged session remains
  unhealthy on subsequent ticks, the counter increments. At `STUCK_NOTIFY_COUNT` (default 3,
  env `HEALTH_STUCK_NOTIFY_COUNT`) an operator-chat warning is posted and a
  `session_terminally_stuck` event is delivered to all peer sessions. At `STUCK_CLOSE_COUNT`
  (default 5, env `HEALTH_STUCK_CLOSE_COUNT`) the session is force-closed via
  `closeSessionById()`. Counter resets on recovery.
- **`src/service-messages.ts`**: Added `SESSION_TERMINALLY_STUCK` entry with
  `eventType: "session_terminally_stuck"`.
- **`src/health-check.test.ts`**: Added 8 new tests in "terminally stuck — consecutive
  unhealthy ticks" describe block (no warning before threshold, warning at threshold, peer
  delivery, no delivery to stuck session, no close before threshold, close at threshold,
  operator force-close message, counter reset on recovery, single-close idempotency).
- **`src/built-in-commands.test.ts`**: Fixed `closeSessionById` mock return type to include
  `name?: string` (pre-existing gap from 50-0864).
- All 2939 tests pass (132 test files). Build passes.

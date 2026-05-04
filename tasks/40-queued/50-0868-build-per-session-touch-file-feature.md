---
id: "50-0868"
title: "Build per-session touch-file feature (Monitor-friendly inbound signal)"
type: task
priority: 50
status: queued
created: 2026-05-04
repo: Telegram MCP
delegation: Worker
depends_on: []
---

# Build per-session touch-file feature

## Background

Operator (2026-05-04) wants this shipped without waiting for Monitor
wakeup-semantics validation. Even if a particular consumer can't
react mid-tool-call, the touch file is a useful feature anyone (Claude
sessions OR external pollers) can consume. Ship the bridge side; agent
integration follows.

Full design captured in `consumer agents repo: tasks/40-queued/30-0942-spike-monitor-kicker-touch-file-validation.md`.
This task implements that design on the TMCP side.

## Scope

Bridge-side only. **Agent owns the file; TMCP just touches it.**

1. New action: `monitor/enable` — opt-in only. Two call shapes:
   - **Agent-supplied path**: agent passes `file_path: <abs path>`.
     TMCP records the path. TMCP does NOT create the file (agent
     owns it). On session close: TMCP forgets the path; agent
     cleans up.
   - **TMCP-supplied path**: agent calls `monitor/enable` with no
     `file_path`. TMCP generates a cryptographically random
     filename in its own data dir (e.g.
     `<bridge_data_dir>/.touch/<random-hash>.stamp`), creates the
     file, returns the absolute path in the response. On session
     close: TMCP deletes its own file.
   - Either way, TMCP does NOTHING until `monitor/enable` is
     called. No default I/O.
2. Companion: `monitor/disable` to stop touching, OR auto-disable
   on `session/close`. Cleanup respects ownership (agent-supplied
   path: TMCP just forgets; TMCP-supplied: TMCP deletes).
3. **Touch fires only after the message is fully ready and enqueued**
   (post-transcription, post-routing, post-enqueue — last step).
4. **Leading + trailing-if-suppressed debounce.** Floor 1s, default
   window 5s, configurable via env or session config.
5. **Activity-aware reset.** While agent is mid-tool-call (any
   recent dequeue/send/react in the last N seconds — default 10s),
   suppress touches.
6. **Max-interval ceiling.** Default 30s, configurable.
7. On `session/close`: TMCP forgets the registered path. If TMCP
   had created the file (TMCP-supplied path mode), TMCP deletes
   it. If agent-supplied: TMCP does not touch the file again,
   agent owns cleanup.
8. If file doesn't exist when TMCP goes to touch it: log warning,
   continue. Don't crash.
9. **Opt-in by default off.** If agent never calls `monitor/enable`,
   TMCP never touches or creates anything. Existing agents
   unchanged.

TMCP does NOT (in agent-supplied mode):

- Allocate or generate filenames.
- Create or delete the touch file.

TMCP DOES (in TMCP-supplied mode):

- Generate a random-hash filename.
- Create the file in its own data dir.
- Delete the file on `session/close`.

In both modes, NOTHING happens until `monitor/enable` is called.

## Acceptance criteria

- `monitor/register` action accepts absolute `file_path` and
  records it against the session.
- Inbound message → registered file's mtime updates within the
  configured cadence.
- Floods within debounce window: max 2 touches (leading +
  trailing-if-suppressed). Single message: 1 touch.
- Activity-reset works: if agent did a tool call within last N
  seconds, touch is suppressed.
- `session/close` clears the registration WITHOUT deleting the
  file.
- File-missing on touch: warning logged, no crash.
- Without registration: zero filesystem activity.
- Spec passes spec-audit.
- Smoke test: agent registers a path, send 10 messages in 1s,
  observe ≤ 2 mtime changes within the window.

## Out of scope

- Agent-side Monitor integration (separate concern; agents opt in).
- Validation that Monitor wakes the agent mid-tool-call (separate
  spike — `30-0942`).
- Channel-based push (different design, on hold pending auth).

## Dispatch

Worker. Sonnet for the design + impl (TS).

## Bailout

Hard cap 4 hours total. 15-min progress heartbeats to Curator. If
the existing TMCP routing layer makes the "post-routing, post-
enqueue" hook awkward to wire cleanly, surface — better to refactor
the routing layer than tape-on a touch fire that can race ahead.

## Related

- `consumer agents repo: tasks/40-queued/30-0942-spike-monitor-kicker-touch-file-validation.md`
  (full design — read first)
- `tasks/40-queued/50-0865-bridge-auto-terminate-stuck-sessions.md`
  (sibling bridge work)
- Operator framing: "we don't need to know if monitor works. We
  should just do this." (2026-05-04)

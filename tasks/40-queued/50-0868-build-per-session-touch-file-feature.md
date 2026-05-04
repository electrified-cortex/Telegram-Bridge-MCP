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

1. New action: `monitor/register` (or as optional param on
   `session/start`). Agent provides an absolute file path.
   TMCP records the path against the session.
2. Companion: `monitor/clear` to unregister, OR auto-clear on
   `session/close`.
3. **Touch fires only after the message is fully ready and enqueued**
   (post-transcription, post-routing, post-enqueue — last step).
4. **Leading + trailing-if-suppressed debounce.** Floor 1s, default
   window 5s, configurable via env or session config.
5. **Activity-aware reset.** While agent is mid-tool-call (any
   recent dequeue/send/react in the last N seconds — default 10s),
   suppress touches.
6. **Max-interval ceiling.** Default 30s, configurable.
7. On `session/close`: TMCP forgets the path. **Does NOT delete
   the file.** Agent owns its own cleanup.
8. If file doesn't exist when TMCP goes to touch it: log warning,
   continue. Don't crash. Agent may have deleted it.
9. Opt-in by construction: if agent never registers, TMCP never
   touches anything. Existing agents unchanged.

TMCP does NOT:

- Allocate or generate filenames.
- Create or delete the touch file.
- Manage a `.touch/` directory.
- Track random hashes.

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

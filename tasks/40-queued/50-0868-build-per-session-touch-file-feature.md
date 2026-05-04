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

Bridge-side only:

1. Per-session touch file at `<bridge_data_dir>/.touch/<random-hash>.stamp`
   (or similar — pick path; document in spec).
2. Filename = cryptographically random hash (NOT the session token).
3. File created on `session/start` (or first inbound message).
4. **Touch fires only after the message is fully ready and enqueued**
   (post-transcription, post-routing, post-enqueue — last step).
5. **Leading + trailing-if-suppressed debounce.** Floor 1s, default
   window 5s, configurable via env or session config.
6. **Activity-aware reset.** While agent is mid-tool-call (any
   recent dequeue/send/react in the last N seconds — default 10s),
   suppress touches.
7. **Max-interval ceiling.** Default 30s, configurable.
8. File deleted on `session/close` — clean teardown.
9. Path returned in `session/start` response so agent can opt in
   to monitoring.

## Acceptance criteria

- `session/start` response includes `touch_path` (absolute, opaque
  random-hash filename).
- Inbound message → file mtime updates within configured cadence.
- Floods within debounce window: max 2 touches (leading + trailing-
  if-suppressed). Single message: 1 touch.
- Activity-reset works: if agent did a tool call within last N
  seconds, touch is suppressed.
- `session/close` deletes the file.
- Token never appears in filename or path.
- Spec passes spec-audit.
- Smoke test: spawn a session, send 10 messages in 1s, observe
  touch file mtime changes ≤ 2 within the window.

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

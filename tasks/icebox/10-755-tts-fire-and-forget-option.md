---
id: "10-755"
title: "TTS send: fire-and-forget option with delivery callback"
priority: 10
status: draft
created: 2026-04-24
repo: Telegram MCP
---

# 10-755 — TTS fire-and-forget option with delivery callback

## Problem

`send(type: "audio", audio: "...")` blocks until TTS synthesis completes and the voice note is uploaded to Telegram. For agents that send a voice message before doing work, this adds 3–8 seconds of dead time per message before the next tool call can proceed.

This is a perceived-responsiveness issue: the agent is frozen from the operator's view until the TTS round-trip finishes, even though no response is needed.

## Goal

Add a `fire_and_forget: true` option to the `send` tool (audio paths only). When set:

- TTS synthesis and upload happen asynchronously (background task/promise)
- The tool returns immediately with `{ queued: true, id: "<delivery-id>" }`
- A delivery event is pushed into the session's dequeue stream when the audio lands:
  `{ event: "audio_delivered", id: "<delivery-id>", ok: true/false }`

The caller can drain the dequeue stream to learn outcome, or ignore it entirely.

## Acceptance Criteria

1. `send(type: "audio", ..., fire_and_forget: true)` returns immediately (< 100ms) with `{ queued: true, id: "..." }`.
2. TTS synthesis + Telegram upload proceed in background; do not block subsequent tool calls.
3. On completion, a `audio_delivered` event appears in the session dequeue stream (same session token).
4. On failure (TTS error, upload timeout), the `audio_delivered` event carries `ok: false, error: "..."`.
5. `fire_and_forget` has no effect on `type: "text"` or `type: "notification"` — silently ignored (never errors).
6. Default behavior unchanged: omitting `fire_and_forget` (or setting `false`) keeps existing blocking semantics.
7. Existing integration tests pass; new tests cover: delivery event appears, concurrent send calls don't interfere, failure path propagates error correctly.

## Superseded (2026-04-24)

Task 10-803 (async TTS send with dequeue callback) implemented this feature as `async: true`
parameter on the send tool (not `fire_and_forget`). All acceptance criteria are met:
immediate return with `{ ok: true, message_id_pending, status: "queued" }`, delivery via
`send_callback` dequeue event. Close this draft.

## Don'ts

- Do not make fire-and-forget the default — blocking is correct for interactive flows.
- Do not drop failed delivery events silently — always enqueue `ok: false`.
- Do not implement for non-audio types — scope is audio TTS only.

## Notes

Operator rationale: agents spend significant wall-clock time per turn blocked on TTS. Fire-and-forget eliminates that latency for announcements and status audio where the agent doesn't need to wait for delivery confirmation.

---
id: 10-803
title: Async (non-blocking) send — voice/audio TTS returns immediately, result via dequeue callback
status: queued
priority: 10
origin: operator voice 2026-04-24 (msg 41755)
---

# Async (non-blocking) send — voice/audio TTS returns immediately, result via dequeue callback

## Problem

Long-form `audio` TTS hits 504 synchronously and blocks the agent's turn. When the agent composes a ~60-second voice message, TTS generation can exceed the bridge/Telegram timeout window — the tool call returns an error, and the agent has to re-attempt with shorter content, losing the flow.

Observed 2026-04-24: audio TTS returned 504 mid-session; sent a text-only fallback instead.

## Desired behavior

- New `async: true` flag on `send(type: "text", audio: "...")` (and related voice-capable modes).
- When `async: true`:
  1. Bridge accepts the request and returns 200 immediately: `{ "ok": true, "message_id_pending": <provisional-id>, "status": "queued" }`. Similar to HTTP 202 Accepted.
  2. Agent's turn unblocked — it continues working.
  3. Bridge processes TTS + Telegram send in the background.
  4. Result arrives as a new event in the agent's dequeue queue: `{ "event": "send_callback", "content": { "pending_id": <id>, "status": "ok" | "failed", "message_id": <real-id>, "error": "..." } }`.
  5. Agent consumes the callback on its next dequeue, knows whether to retry/fix.
- Default remains synchronous (backwards-compatible).

## Motivation

- 60-second audio generation regularly hits 504.
- Agent's turn is a scarce, expensive resource — blocking on TTS wastes it.
- Async decouples agent composition from TTS latency.
- Pattern matches existing bridge philosophy: queue-based event delivery.

## Requirements

- `async: true` is opt-in per call.
- Callback event type is distinguishable from user messages (new `event: "send_callback"` or similar).
- Failure callback includes enough info to act: HTTP status, error string, the pending_id used to correlate.
- On async failure: if the send had a `text` component, bridge must inline-deliver the text as a plain message with a `⚠ [async failed]` prefix so the agent does not resend; callback must include `text_fallback: true` + the error code so agent knows text was already delivered.
- Provisional `message_id_pending` is valid for correlation only — do NOT use it for `edit`/`pin`/`react` until the callback confirms the real `message_id`.
- FIFO send ordering: async sends must enqueue behind all preceding sends (both sync and async); Telegram message delivery order must match submission order regardless of TTS completion time.
- Queue ordering: callback events delivered in submission order (FIFO), not completion order.

## Acceptance criteria

- [ ] `send(async: true)` accepted without breaking existing sync behavior.
- [ ] Immediate return with `status: "queued"` + `message_id_pending`.
- [ ] Success callback delivered via dequeue with real `message_id`.
- [ ] Failure callback delivered with HTTP status + error string.
- [ ] Test: trigger a known-504 length audio with `async: true` → agent receives failure callback on next dequeue, not synchronous error.
- [ ] Docs updated — help topic explains when to use async (long TTS) vs sync (short confirmations, interactive prompts).

## Don'ts

- Don't make async the default. Sync is simpler for short messages and interactive flows (confirm, ask).
- Don't omit failure callbacks. Silent drops are worse than 504s.
- Don't invent a new persistent state machine per async send — use the existing queue as the delivery channel.
- Don't allow `edit`/`pin`/`react` on `message_id_pending`. Those need the real ID post-callback.

## Open decisions

- Should `async: true` also work for `type: "file"` (upload), `type: "notification"`, etc.? Probably — any send that can 504 benefits. But scope-limit the first cut to `audio`.
- Timeout on the async job itself — bridge should give up at some point (e.g., 5 min); deliver a `status: "timeout"` callback.
- Retries — does the bridge retry on transient failures, or is one attempt + callback enough? Lean toward one attempt + explicit callback so agent decides.

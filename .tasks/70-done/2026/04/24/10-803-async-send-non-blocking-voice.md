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

## Activity Log

- **2026-04-24** — Pipeline started. Variant: Design + Implement.
- **2026-04-24** — [Stage 2] Feature Designer dispatched. Design received (7 sections). OQ-1 (Architecture: session-close teardown) and OQ-3 (Policy: typing indicator) resolved by Overseer before Stage 4.
- **2026-04-24** — [Stage 3] Design reviewed. Clean — all 7 sections present, criteria verifiable, open questions escalated and resolved.
- **2026-04-24** — [Stage 4] Task Runner dispatched ×3. 10 files changed. Pre-existing `server.ts` duplicate import fixed. Lint and test regressions fixed (mock gaps in send.test.ts, route_message.test.ts).
- **2026-04-24** — [Stage 5] Verification: diff non-empty, 2585 tests passed, lint clean.
- **2026-04-24** — [Stage 6] Code Reviewer ×3: 0 critical, 0 major (after 2 fix iterations resolving 1 blocker + 8 majors). Remaining: 2 minor, 1 nit.
- **2026-04-24** — [Stage 7] Complete. Branch: 10-803, commit: a7a9181. Ready for Overseer review.

## Completion

### What was implemented

Added `async: true` opt-in flag to `send(type: "text", audio: "...")`. When set, the bridge returns `{ ok: true, message_id_pending: <negative-int>, status: "queued" }` immediately and processes TTS + Telegram send in the background via a per-session FIFO serial promise chain. The result arrives as a `send_callback` dequeue event with `status: "ok" | "failed" | "timeout"`. On failure with a `text` component, a plain-text fallback is sent first with `⚠ [async failed]` prefix, then the callback with `text_fallback: true`. Timeout defaults to 5 min (configurable via `ASYNC_SEND_TIMEOUT_MS` env). Session teardown cancels in-flight jobs gracefully. Pre-existing `server.ts` duplicate import also fixed.

### Files changed
- `src/async-send-queue.ts` (NEW) — per-session async job queue, serial executor, finalised-job tracking
- `src/async-send-queue.test.ts` (NEW) — 440 lines, full coverage of all paths
- `src/session-queue.ts` — `deliverAsyncSendCallback`, `AsyncSendCallbackPayload`
- `src/tools/send.ts` — `async` flag, early-return path, `_timeoutMs` env parsing
- `src/tools/send.test.ts` — mock for `async-send-queue.js`, async path tests
- `src/session-teardown.ts` — `cancelSessionJobs` call with ordering comment
- `src/debug-log.ts` — `"async-send"` debug category
- `src/server.ts` — pre-existing duplicate import removed
- `src/first-use-hints.ts` — pre-existing always-false guard removed
- `src/tools/route_message.test.ts` — missing mock entries added

### Subagent passes
Feature Designer ×1, Task Runner ×3, Code Reviewer ×3

### Final review verdict
0 critical, 0 major, 2 minor, 1 nit

### Minor findings noted (not blocking)
- `flushJobs()` test helper uses 10 arbitrary Promise yields (fragile to implementation depth changes)
- `failure + captionOverflow: true` sends raw MarkdownV2 escapes as plain-text fallback (best-effort)

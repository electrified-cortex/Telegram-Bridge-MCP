# 093 — Voice Transcription Failure Service Message

**Priority:** 093
**Status:** Queued
**Created:** 2026-03-18

## Problem

When voice transcription fails (service down, corrupted audio, timeout), the poller sets an error reaction but doesn't notify the agent via a service message. The agent may not realize the voice message was never transcribed.

## Proposed change

Deliver a service message to the target session when transcription fails:

```json
{
  "event": "service_message",
  "content": {
    "type": "voice_transcription_failed",
    "message_id": 9645,
    "reason": "service_timeout",
    "details": "Transcription service did not respond within 30s"
  }
}
```

## Implementation

1. In `poller.ts`, the transcription pipeline has a failure path that currently:
   - Sets an error text in the voice event content (e.g., `[transcription failed]`)
   - Sets an error reaction (❌ or 😴)
2. Add a `deliverServiceMessage` call in the failure path
3. Include the failure reason and original message ID so the agent can ask the operator to resend

## Acceptance criteria

- [x] On transcription failure, a `voice_transcription_failed` service message is delivered to the target session queue
- [x] The service message includes: message_id, reason (`service_timeout` or `service_error`), human-readable details
- [x] Existing voice event content still includes error text (backwards compatible)
- [x] Agent docs updated (`docs/inter-agent-communication.md` service message table)

## Completion

Implemented 2026-03-19. Added `deliverVoiceTranscriptionFailed(messageId, reason, details)` to `session-queue.ts` — routes to governor (or broadcasts if no governor) mirroring `routeToSession` ambiguous routing. In `poller.ts` catch block, detects timeout vs service errors and calls the new function. 3 tests added to `poller.test.ts`. All 1462 tests pass, build and lint clean.

# Bug: Voice message missed when agent quiet during async transcription

**Reported:** 2026-05-27 (operator + Unit-12 observation)
**Priority:** 20
**Area:** Voice / transcription / activity-file kick

## Symptom

Agent goes unresponsive to a voice message. When investigated, the agent is alive but appears to have never received the message. Voice messages require async transcription before delivery — hypothesis is that the activity-file kick fires on message *arrival* but the transcription-complete event does not re-kick if the agent has gone quiet by the time transcription finishes.

## Hypothesis

1. Voice message arrives → activity file touched → agent wakes, dequeues
2. Message is pending transcription — dequeue returns it as "processing" or omits it
3. Agent goes quiet (no pending work)
4. Transcription completes — but no second kick is issued to the activity file
5. Agent never sees the transcribed message until next organic wake

## Investigation needed

- Confirm whether TMCP touches the activity file on transcription completion (not just on message arrival)
- Check Unit-12's session logs around the incident for kick timing vs message timestamps
- Reproduce: send voice message to a quiet agent, observe whether it wakes on transcription complete

## Fix direction

Ensure activity file is touched (or a dequeue event emitted) when voice transcription completes, not only when the raw message arrives.

## Unit-12 diagnostic (2026-05-28T05:32 UTC)

Unit-12 confirmed: voice messages DO generate activity kicks in normal operation. The two "Hello?" incidents were:
1. Compaction recovery silence — Unit-12 was re-arming monitors, not dark
2. Batch-drain delay — 5 messages pending, Unit-12 was processing before responding
3. One TTS `fetch failed` at ~10 PM — audio didn't deliver, no text fallback (TTS infra failure, not kick issue)

Unit-12 did NOT observe a confirmed missing-kick case, but notes the pattern is theoretically possible: if the kick fires before transcription completes, dequeue returns a non-content event, agent moves on, and voice content is missed until next organic wake.

**Unit-12 recommendation:** Check TMCP logs for `transcription_complete` events that fired significantly after `message_received`, with no subsequent activity-file kick.

The "Hello?" incidents appear to be UX perception issues (compaction gap + batch drain) rather than confirmed transcription-kick bugs. Bug status: **unconfirmed — possible edge case.**

## Source

- Operator voice 62932 — `tasks/00-ideas/voice-async-transcription-sleep-bug-voice-62932-2026-05-27.md`
- Unit-12 outbox report: the agents host (`<deploy-root>/unit12/.unit12-pod/outbox/20260528T053206Z-96c22cc3.txt`)


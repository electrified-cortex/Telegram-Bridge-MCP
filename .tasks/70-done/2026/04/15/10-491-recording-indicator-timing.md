---
id: 10-491
title: Recording indicator drops before voice message arrives
priority: 10
type: bug
status: draft
created: 2026-04-11
---

# 10-491 — Recording Indicator Drops Before Voice Message Arrives

## Problem

When an agent sends a voice message (TTS), the bridge sets a "recording voice message" chat action indicator. This indicator disappears before the actual voice message arrives in the chat. The operator sees the recording indicator go away, then waits in an awkward gap before the voice message appears.

## Expected Behavior

The recording indicator should persist until the voice message is actually delivered (message sent to Telegram API successfully). The human should see: recording indicator → voice message appears → indicator naturally stops.

## Investigation Needed

1. How does the bridge currently set the recording chat action? One-shot or repeated?
2. What's the lifecycle: `sendChatAction("record_voice")` → TTS processing → upload → `sendVoice()` — at what point does the action expire?
3. Telegram's `sendChatAction` lasts ~5 seconds — is TTS + upload taking longer?
4. Should the bridge repeat `sendChatAction` in a loop until the voice message is sent?
5. Does the Telegram Bot API automatically cancel the action when `sendVoice` completes?

## Acceptance Criteria

- [ ] Recording indicator visible until voice message arrives
- [ ] No awkward gap between indicator disappearing and message appearing
- [ ] Works for both short and long voice messages (TTS can vary)

## Completion

**Date:** 2026-04-15
**Branch:** `10-491`
**Commit:** `4276a35`

### What was done

Extended the recording voice indicator to stay active throughout the entire TTS+upload process.

**Root cause:** `sendChatAction("record_voice")` expires after ~5 seconds. The initial `typingSeconds` estimate (text length / 20) could expire before all chunks finished synthesizing and uploading, leaving a visible gap.

**Fix:** In `src/tools/send.ts`, added a `RECORD_VOICE_EXTEND_SECS = 30` constant and call `showTyping(RECORD_VOICE_EXTEND_SECS, "record_voice")` before each chunk's synthesis. The existing `typing-state.ts` loop detects the already-running interval and only extends the deadline — no extra Telegram API calls are made. The `finally { cancelTyping() }` block stops the interval immediately after the last voice message is delivered.

### Acceptance Criteria

- [x] Recording indicator visible until voice message arrives
- [x] No awkward gap between indicator disappearing and message appearing
- [x] Works for both short and long voice messages

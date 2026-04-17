# Recording Indicator Gap — extend until message delivery

**Priority:** 10
**Created:** 2026-04-17
**Reporter:** Operator (voice feedback)

## Problem

When sending a voice message: show-typing fires (text generation), then the recording indicator appears during TTS conversion (beautiful). But after TTS completes and before the voice message appears to the user, there's a 2-5 second gap with no indicator. The recording indicator stops but the message hasn't arrived yet.

## Expected Behavior

The recording indicator should stay active until the voice message is confirmed delivered to the user. No gap between indicator and message appearance.

## Acceptance Criteria

- [x] Recording indicator persists until voice message send is confirmed
- [x] No visible gap between indicator stopping and message appearing
- [x] Works for all voice message sends (audio-only, hybrid audio+caption)

## Completion

**Commit:** e95924f  
**PR:** #140  
**Branch:** 10-recording-indicator-gap  

**Root cause:** `notifyAfterFileSend()` in `outbound-proxy.ts` cancelled the typing indicator on API ack, but Telegram takes 2-5s to render voice messages after that.

**Fix:**
- Removed premature `cancelTypingIfSameGeneration` from `notifyAfterFileSend`; removed `_fileSendTypingGenBySid` map (now dead code)
- In `send.ts`, `confirm.ts`, `choose.ts`: capture generation before send, gate 3s delay on success only, cancel via `cancelTypingIfSameGeneration(gen)` to avoid killing a subsequent indicator
- Updated all affected test mocks and assertions (2347/2347 pass)

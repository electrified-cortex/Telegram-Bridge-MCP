# Recording Indicator Gap — extend until message delivery

**Priority:** 10
**Created:** 2026-04-17
**Reporter:** Operator (voice feedback)

## Problem

When sending a voice message: show-typing fires (text generation), then the recording indicator appears during TTS conversion (beautiful). But after TTS completes and before the voice message appears to the user, there's a 2-5 second gap with no indicator. The recording indicator stops but the message hasn't arrived yet.

## Expected Behavior

The recording indicator should stay active until the voice message is confirmed delivered to the user. No gap between indicator and message appearance.

## Acceptance Criteria

- [ ] Recording indicator persists until voice message send is confirmed
- [ ] No visible gap between indicator stopping and message appearing
- [ ] Works for all voice message sends (audio-only, hybrid audio+caption)

# Testing: Voice salute (🫡) edge cases and race conditions

## Type

Testing

## Description

The voice salute (🫡) reaction is set on voice messages when they're dequeued by `dequeue_update`. This worked intermittently — all voice messages in the 2026-03-16 session lacked salute, but it appears to work after a clean restart on 2026-03-17. The bug is likely a race condition or transient failure that needs comprehensive test coverage to prevent regressions.

## Background

The voice lifecycle has three reaction phases:
1. **✍ (transcribing)** — set by the poller when transcription starts
2. **😴 (queued)** — set by the poller after transcription, if no waiter is active
3. **🫡 (acknowledged)** — set by `ackVoice()` when the agent dequeues the message

Each phase replaces the previous reaction via `setMessageReaction`.

## Code Path

1. `src/tools/dequeue_update.ts` — `ackVoice(evt)` called for each event in batch
2. `ackVoice()` — filters `event.from === "user"` && `event.content.type === "voice"`, then calls `ackVoiceMessage(event.id)`
3. `src/telegram.ts` `ackVoiceMessage()` — resolves chat, dedup check via `getBotReaction`, fire-and-forget `trySetMessageReaction`
4. `trySetMessageReaction()` — `getApi().setMessageReaction()`, swallows ALL errors (`.then(() => true, () => false)`)

Also called from:
- `src/tools/ask.ts` — when a voice message matches the `dequeueMatch` predicate
- `src/tools/button-helpers.ts` — when a voice message arrives during `pollButtonOrTextOrVoice`

## Edge Cases to Test

### 1. Race: poller sets 😴 while ackVoice sets 🫡
- The poller's `_transcribeAndRecord` sets 😴 AFTER patching voice text
- `ackVoice` fires when the agent dequeues the (already-transcribed) event
- If both API calls overlap, Telegram may reject one
- **Test:** Verify ackVoice is called and succeeds even when poller recently set 😴

### 2. Race: multiple voice messages in rapid succession
- User sends 3-4 voice messages quickly (as happened in the 2026-03-16 session)
- Poller processes them in parallel (`Promise.all`)
- All hit `setMessageReaction` at roughly the same time
- Rate limiting may silently eat some calls
- **Test:** Batch of voice events → verify ackVoiceMessage called for each

### 3. Session queue path vs global queue path
- Existing tests only cover the global `dequeueBatch` mock
- When `sessionQueue` exists, `dequeueBatchAny()` calls `sessionQueue.dequeueBatch()` instead
- The ack still fires (`for evt of batch`), but this code path has ZERO test coverage
- **Test:** Mock `getSessionQueue` to return a queue with voice events, verify ack fires

### 4. Fire-and-forget swallowed errors
- `trySetMessageReaction` catches ALL errors and returns false
- `ackVoiceMessage` logs to stderr on failure — but the fire-and-forget `void` means nothing propagates
- **Test:** Verify that when `trySetMessageReaction` fails, the stderr log fires and `recordBotReaction` is NOT called

### 5. Dedup false positive via `getBotReaction`
- `getBotReaction` checks `_botReactionIndex` for 🫡
- The poller DOES NOT call `recordBotReaction` for ✍ or 😴 — only `ackVoiceMessage` records 🫡
- If something else recorded 🫡 before dequeue, the ack skips
- **Test:** Pre-set `getBotReaction` to return 🫡, verify ackVoiceMessage is a no-op

### 6. `resolveChat()` returns non-number
- If `ALLOWED_USER_ID` is not configured, `resolveChat()` returns an error object
- `ackVoiceMessage` silently returns without setting the reaction
- **Test:** Mock `resolveChat` to return error, verify no API call made

### 7. Blocking wait path (not just immediate batch)
- When `timeout > 0` and the queue is initially empty, the dequeue waits
- When an event arrives, the blocking path also calls `ackVoice` on the batch
- **Test:** Simulate the blocking wait path returning a voice event, verify ack fires

### 8. ask/choose/confirm voice ack paths
- These tools have their own dequeue paths that also call `ackVoiceMessage`
- Verify they fire correctly when a voice message is received instead of a button press or text

## Acceptance Criteria

- [ ] Tests cover all 8 edge cases above (or document why any are not applicable)
- [ ] All tests pass: `pnpm test`
- [ ] No new lint errors: `pnpm lint`
- [ ] Build clean: `pnpm build`
- [ ] Report back with test count and any findings about actual bugs discovered
- Check if `trySetMessageReaction` is actually resolving `true` or `false`
- Check outbound proxy interception of `setMessageReaction`

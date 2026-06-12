# Task #032 — Voice Routing Test Coverage

| Field    | Value                           |
| -------- | ------------------------------- |
| Priority | 10 (critical safety net)        |
| Created  | 2026-03-20                      |
| Type     | **Implementation** — add tests  |

## Goal

Add unit and integration tests that verify voice messages sent as replies correctly route to the owning worker session. The existing test suite has no voice-specific routing tests — this is a safety gap.

## Context

- `src/message-store.test.ts` tests voice recording and `patchVoiceText`, but **never** tests a voice message with `reply_to_message` (voice-as-reply).
- `src/multi-session.integration.test.ts` tests `routeToSession` with `replyEvent()` (text replies) and `callbackEvent()`, but never with a voice-type event.
- The two-phase voice flow (Phase 1: `recordInbound` routes immediately with `text: undefined`, Phase 2: `patchVoiceText` fills in transcription) is not tested end-to-end through the routing layer.

## Tests to Add

### 1. message-store.test.ts — voice reply_to

In `recordInbound — voice messages` describe block:

- **"captures reply_to on a voice reply"** — Create a `voiceUpdate` with `reply_to_message` on the update's message. Call `recordInbound`. Verify the resulting event has `content.reply_to` set to the replied-to message ID.

### 2. multi-session.integration.test.ts — voice routing

In `targeted routing` describe block, add three tests:

- **"voice reply routes to owning session"** — Set up 2+ sessions. `trackMessageOwner(msgId, s2.sid)`. Create a voice-type `TimelineEvent` with `content.reply_to = msgId`. Call `routeToSession`. Assert only s2's queue receives it.

- **"voice reply with governor routes to owning session, not governor"** — Same setup but with governor set. A targeted voice reply should bypass governor routing and go directly to the owning session.

- **"voice message without reply_to goes to governor"** — Voice with no `reply_to` or `target` is ambiguous → governor receives it (or broadcast if no governor).

### 3. Two-phase voice routing (new describe block)

In `multi-session.integration.test.ts`, add a new top-level describe:

- **"two-phase voice: routed event receives transcription patch"** — Set up 2 sessions. `trackMessageOwner(50, s2.sid)`. Create and route a voice event with `reply_to: 50`, `text: undefined`. Verify it's in s2's queue. Then simulate `patchVoiceText` and verify the text appears on the already-queued event (same object reference).

## Acceptance Criteria

- [ ] All new tests pass (`pnpm test`)
- [ ] No changes to production code — tests only
- [ ] Build and lint clean

## Files to Modify

- `src/message-store.test.ts` — 1 new test
- `src/multi-session.integration.test.ts` — 4 new tests

## Reference Code

Voice update factory in `message-store.test.ts` (line ~110):
```ts
function voiceUpdate(msgId: number): Update {
  // ... creates update with voice field
}
```

Reply event factory in `multi-session.integration.test.ts` (line ~74):
```ts
function replyEvent(replyTo: number): TimelineEvent {
  return makeEvent({
    content: { type: "text", text: "reply", reply_to: replyTo },
  });
}
```

Pattern for voice variant:
```ts
function voiceReplyEvent(replyTo: number): TimelineEvent {
  return makeEvent({
    content: { type: "voice", reply_to: replyTo },
  });
}
```

## Completion

- Added 1 test to `message-store.test.ts`: voice `reply_to` captured via `getMessage()` (not dequeue, since voice without text is not ready)
- Added `voiceReplyEvent()` helper + 5 tests to `multi-session.integration.test.ts`:
  - Targeted routing: voice reply routes to owning session (pendingCount check)
  - Targeted routing: voice reply bypasses governor when owner is known
  - Targeted routing: voice without reply_to goes to governor (ambiguous)
  - Two-phase: unready event stays in queue; text patch makes it dequeue-ready (same object ref)
- Key insight: voice events without `text` are non-ready in `TemporalQueue` — routing tests use `pendingCount()` instead of `drain()` to verify queue placement
- All 1627 tests pass, build and lint clean
- Changes committed to main workspace (no worktree — tests only)

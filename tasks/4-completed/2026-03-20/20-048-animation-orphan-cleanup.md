# Task #048 — Animation Orphan Message on Edit Failure

## Strategy

Direct (no branch) — single-file bug fix in `src/animation-state.ts`.

## Bug Description

In `animation-state.ts`, the `updateDisplay` function handles edit failures by setting `_displayedMsgId = null` and sending a new message. But it **never deletes the old message**, leaving a static orphan in the chat showing the last animation frame.

**Location:** `src/animation-state.ts`, `updateDisplay()` function, lines ~260–263.

**Current code:**

```ts
} catch {
  // Edit failed — message gone; need to send a new one
  _displayedMsgId = null;
  _displayedChatId = null;
}
```

**Problem:** The comment says "message gone" but the edit could fail for other reasons (race condition, network error, rate limit). The message may still exist in the chat, now permanently showing its last animation frame — a "detached" animation.

## Reproduction

1. Start a persistent animation (creates msg N)
2. Trigger a send that promotes the animation and restarts it (creates msg N+1)
3. Call `show_animation` again — `updateDisplay` tries to edit msg N+1
4. If the edit fails (race, error), msg N+1 stays visible as a static orphan
5. New animation is sent at msg N+2

## Fix

In the `updateDisplay` catch block, attempt to delete the old message before proceeding:

```ts
} catch {
  // Edit failed — delete the old message to prevent orphaned animation frames
  const orphanChatId = existingChatId;
  const orphanMsgId = existingMsgId;
  _displayedMsgId = null;
  _displayedChatId = null;
  try {
    await bypassProxy(() => getRawApi().deleteMessage(orphanChatId, orphanMsgId));
  } catch { /* message already gone — cosmetic */ }
}
```

## Acceptance Criteria

- [ ] `updateDisplay` deletes the old animation message when edit fails
- [ ] Existing animation tests pass
- [ ] New test: edit failure → old message deleted, new message sent
- [ ] No orphaned animation messages left in chat after any failure path

## Completion

**Date:** 2026-03-20

### Changes

- `src/animation-state.ts` — In `updateDisplay()` catch block, added best-effort `deleteMessage` call before resetting `_displayedMsgId` to null. Uses `bypassProxy` for consistency with other API calls in the function. Fire-and-forget (`.catch(() => {})`).
- `src/animation-state.test.ts` — Added two new tests in `startAnimation` describe block:
  - `"deletes orphan and sends new message when editMessageText fails on update"` — verifies `deleteMessage` is called with the old message ID and a new message is sent when edit fails.
  - `"continues (sends new message) even if deleteMessage also fails on orphan cleanup"` — verifies the animation still recovers even if the delete also throws.
- `changelog/unreleased.md` — Added `Fixed` entry.

### Test Results

- Build: ✅ passed
- Tests: ✅ 1425 passed (64 files)
- Lint: ✅ passed


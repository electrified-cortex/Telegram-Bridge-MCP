# 019 — Animation Cascade Display Fix

**Type:** Bug fix
**Priority:** 10 (high — affects multi-session UX)
**Status:** Queued

## Problem

During manual testing of the animation priority stack (task #009), the cascade from a higher-priority animation back to a lower-priority buried animation does not work correctly when the `beforeTextSend` interceptor consumes the top animation.

### Reproduction

1. Worker (SID 2) starts `show_animation("thinking", priority: 0)` → creates animation msg (e.g. 11118)
2. Overseer (SID 1) starts `show_animation("working", priority: 1)` → takes over msg 11118 (higher priority)
3. Overseer sends `send_text("some announcement")` → the `beforeTextSend` interceptor:
   - Captures the animation message (11118)
   - Removes SID 1's entry from the stack via `_stack.shift()`
   - Edits msg 11118 to contain the text content (R4 path — animation is last message)
   - Since it was temporary, calls `clearSendInterceptor(sid)` then `cascade()`
4. `cascade()` finds Worker's SID 2 entry still in the stack → calls `updateDisplay(next)`
5. `updateDisplay` tries to **edit msg 11118** with the Worker's animation frame — but msg 11118 now contains real text content

### Root Cause

The cascade uses `updateDisplay()` which edits `_displayedMsgId` in place. After the send interceptor promotes text into the animation message, that message now holds user-visible content. The cascade should **not** edit that message — it should create a **new** message for the cascaded animation.

### Key Code Locations

- `src/animation-state.ts`:
  - `beforeTextSend` interceptor (line ~425): captures and promotes text into animation msg
  - `cascade()` (line ~295): calls `updateDisplay(next)` which reuses `_displayedMsgId`
  - `updateDisplay()` (line ~235): creates OR edits the display message — edits if `_displayedMsgId` is non-null

### Expected Fix

After the `beforeTextSend` interceptor promotes text into the animation message:
1. Set `_displayedMsgId = null` (already done on line ~437)
2. When `cascade()` calls `updateDisplay(next)`, `_displayedMsgId` being null should trigger a **new** message send instead of an edit

Verify that the R4 path (edit in place) correctly nulls `_displayedMsgId` before calling `cascade()`. The R5 path (delete animation) should also work because it deletes the message first.

### Debug Evidence

- `cancel_animation` returned `{ cancelled: false }` — the entry was already consumed by the interceptor
- Debug log shows no cancel or cascade entries logged after id=51 (the push), suggesting cascade may have errored silently
- Operator could not see the Worker's animation resume after the Overseer's was consumed

## Acceptance Criteria

1. When the top animation is consumed by `beforeTextSend`, the buried animation cascades correctly by creating a **new** message
2. Debug log entries for cascade events are present and correct
3. `cancel_animation` on the cascaded animation works normally
4. Unit tests cover the cascade-after-text-promotion scenario
5. Manual test: two sessions, higher-priority consumes via text send, lower-priority resumes visually

## Worktree

Branch: `fix/animation-cascade-display`
Base: `v4-multi-session` at current HEAD

# Feature: Animation and Checklist Conflict Resolution

## Type

Feature / UX

## Priority

300

## Description

When two sessions run concurrently, both may try to:

- `show_animation` — only one animation can be active at a time (server enforces this)
- `pin_message` — Telegram allows one pinned message per chat
- `send_new_checklist` — no conflict, but visual clutter if two checklists are updating simultaneously
- `show_typing` — only one typing indicator per bot (Telegram enforces this)

Currently: `show_animation` replaces any active animation globally. This means session 2 starting an animation cancels session 1's animation silently. Same for `show_typing`.

## Impact

- Session 1 shows "Thinking..." animation. Session 2 starts "Building..." animation. Session 1's animation disappears with no warning. Session 1 thinks its animation is still running.
- Both sessions try to pin their checklist. Only the last pin survives.

## Design Sketch

### Option A: Per-session animation state

Each session has its own animation message. `show_animation` only touches the calling session's animation. `cancel_animation` only cancels the calling session's. Multiple animations can coexist in the chat.

**Pro:** No conflicts. Each session is independent.
**Con:** Chat gets noisy with multiple cycling animations.

### Option B: Shared animation with session priority

Governor's animation takes priority. If a non-governor session tries to `show_animation` while the governor has one active, it's queued or rejected.

**Pro:** Clean chat. Governor controls the visual flow.
**Con:** Non-governor agents can't show status.

### Option C: Document and accept (current behavior)

The current behavior is fine — agents should be aware that animations are global. If an agent's animation gets replaced, it continues working normally. The animation is cosmetic.

## Recommendation

Option A (per-session animation state) is the cleanest. It requires changes to `animation-state.ts` to track animations by SID instead of globally. Typing indicator conflicts are a Telegram limitation and can't be fixed server-side.

## Code Path

1. `src/animation-state.ts` — Currently stores a single global animation. Refactor to use a `Map<number, AnimationState>` keyed by SID. Export `getAnimationState(sid)`, `setAnimationState(sid, state)`, `clearAnimationState(sid)`.
2. `src/tools/show_animation.ts` — Already receives SID via identity tuple. Pass to animation-state.
3. `src/tools/cancel_animation.ts` — Same: scope cancel to the calling session's SID.
4. `src/animation-state.test.ts` — Add tests for per-SID isolation.

The cycling/editing loop in animation-state already uses message IDs — each session will have its own message ID, so concurrent animations naturally target different messages.

## Acceptance Criteria

- [ ] Animation state tracked per session (not global)
- [ ] `show_animation(sid)` and `cancel_animation(sid)` scope to session
- [ ] Multiple sessions can have independent animations
- [ ] Document typing indicator limitation (Telegram-side, unfixable)
- [ ] Tests: two sessions with independent animation lifecycles
- [ ] All tests pass: `pnpm test`

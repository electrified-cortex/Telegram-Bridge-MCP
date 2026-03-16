# Animation System Specification

## Rules

**R1 — Singleton.** Only one animation visible at a time. Starting a new one cancels the old (regardless of mode).

**R2 — Always timeout.** Every animation has a TTL. Temporary: default 120s. Persistent: default 600s.

**R3 — Agent-driven.** Animation state only changes in response to agent/bot actions, never user messages. Users can send unlimited messages — animation stays put until the agent acts.

**R4 — Edit, don't delete.** When the bot sends a message and the animation is the last message: edit the animation → real content. Avoids Telegram's visible "disintegrate" deletion animation. If the animation is NOT the last message (user messages pushed it up): delete it instead — editing a stale-position message would look wrong.

**R5 — Minimize deletes.** Only delete when you must: file sends (can't edit text → file), animation not in last position, or explicit cancel without replacement text.

## Two Modes

### Temporary (default, `persistent: false`)

- **One-shot.** The animation exists until the next bot message, `show_typing`, or timeout.
- When the bot sends a message:
  - If animation is last message → edit → real content → **done** (no restart).
  - If animation is not last message → delete animation → bot message lands normally → **done**.
- `show_typing` immediately cancels the animation (deletes it).
- Short TTL — default 120s.
- Use case: "I'm processing your message, something is coming."

### Persistent (`persistent: true`)

- **Continuous.** The animation restarts after each bot message until explicitly cancelled.
- When the bot sends a message:
  - If animation is last message → edit → real content → **restart animation below** (streaming illusion).
  - If animation is not last message → delete animation → bot message lands normally → **restart animation below**.
- `show_typing` does NOT cancel persistent animations.
- Long TTL — default 600s.
- TTL resets (halved) on each bot send to catch forgotten animations.
- Use case: "I'm working on a multi-step task, messages are streaming."

## Position Detection

To decide edit vs delete, the system must know if the animation message is still the "last message" in the chat. This is determined by comparing the animation's `message_id` against the highest known message_id (tracked from sends + received updates).

## show_typing Interaction

- Temporary mode: `show_typing` cancels the animation immediately (delete).
- Persistent mode: `show_typing` has no effect on the animation.
- Rationale: Typing indicator means "something is about to arrive," which makes a temporary placeholder obsolete. Persistent animations are long-running and agent-controlled.

## Open Edge Cases

### Animation repositioning

If user messages push the animation up in history, the animation is no longer at the bottom. When the bot's next message arrives, the system detects this and deletes (instead of editing) the animation. The "not last message" check handles this.

### Named presets

The preset system (`registerPreset`, `getPreset`) supports named animation configurations like "thinking" (🤔 + rotating dots) or "working" (🔧 + rotating dots). Presets are session-scoped — registered at runtime and gone on restart.

### Disposable pattern (future)

An `AnimationSession` class that owns state, timers, and interceptor with a clean `dispose()` method would eliminate several edge cases. Candidate for future refactor once flows are settled.

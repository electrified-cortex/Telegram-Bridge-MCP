# Presence Signals

Silence during multi-step work is indistinguishable from stuck or crashed.
Use presence signals to keep the operator informed.

## One Rule

**`show-typing` is a lie if no text is actually coming.** Sending show-typing when you are thinking (not composing) misleads the operator. Pick the right signal for what you are actually doing.

## Decision Tree

| Situation | Signal |
| --- | --- |
| Text reply is being composed | `show-typing` — honest indicator; only if text is actually arriving |
| Thinking, reply not yet composed | `thinking` animation — temporary, overwritten by next outbound |
| Long message to absorb, need time | `processing` preset reaction, then `thinking` → `working` animation |
| Heavy work beginning | `working` animation, or short ack ("got it, starting X") then `working` |

## Hierarchy (cheapest → richest)

1. **Reaction** — single emoji on a message. Zero text. Use for quick acknowledgement.
2. **show-typing** — typing indicator, lasts up to 20 s. Use only when text is actually arriving.
3. **Animation (persistent)** — cycling frame loop. Use for work taking 30 s+.
4. **Progress** — percentaged bar for work with a known completion dimension. Use `send(type: "progress")` + `action(type: "progress/update", percent: N)`. Close explicitly when done — orphaned bars stay pinned.

## Animation Presets for Working

- `working` — working indicator animation
- `thinking` — thinking/processing animation

Start with: `send(type: "animation", preset: "working")`

## Silent-Work Detector

TMCP automatically monitors session silence. The window opens the moment you **dequeue a user message**. It does not open during empty-queue polls (`empty` / `timed_out` responses).

**Thresholds** (default 30 s, floor 15 s, configurable per-session):

- **< 30 s:** Normal thinking — no action needed.
- **30 s:** Envelope hint on your next dequeue response: `silence: Ns since last dequeue; operator sees no progress`. Lightweight nudge — pick up any ack signal.
- **60 s:** Service message — stronger weight. The operator cannot distinguish working from stuck.

Any ack signal (message, reaction, typing, animation) clears the window.
Active animations suppress all nudges — they are sufficient presence signals.

## Stale Animation Warning

If your session has been idle in the dequeue loop for more than 30 seconds while an animation is still active, the bridge injects an `animation_stale_warning` service event into your queue. This surfaces during your next `dequeue` call as a service message with `event_type: "animation_stale_warning"` and fields `message_id` and `age_seconds`.

**What to do:** Check `action(type: "animation/status", token: <token>)` to confirm the animation is still active, then cancel it if you are no longer producing output: `action(type: "animation/cancel", token: <token>)`.

Warnings are rate-limited to once per 120 seconds per session to avoid flooding an idle loop.

## Animation Lifecycle

Persistent animations are **not decoration**. They are for ongoing work where progress messages will flow in (the append-mode pattern: animation → send content → animation promoted to content → repeat → cancel when done).

Rules:
- Start: `send(type: "animation", preset: "working")` — use a named preset, keep timeout explicit
- Update: send messages normally — the outbound proxy promotes the animation to real content
- Cancel: `action(type: "animation/cancel")` — always cancel when work completes
- Check: `action(type: "animation/status")` — returns `{ active, message_id, started_at, expires_at }`

**Stale-on-idle warning:** When your dequeue blocks on an empty queue and an animation is running,
the bridge injects `{ event: "animation_stale_warning", message_id, age_seconds }` into the response.
Act on it — either cancel (if you forgot) or ignore if work is genuinely in progress.

## Opt-Out

Per-session disable is not yet exposed via an action. The detector is active for all sessions.
Default: **on** for all sessions.

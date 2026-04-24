# Presence Signals

Silence during multi-step work is indistinguishable from stuck or crashed.
Use presence signals to keep the operator informed.

## One Rule

**`show-typing` is a lie if no text is actually coming.** Sending show-typing when you are thinking (not composing) misleads the operator. Pick the right signal for what you are actually doing.

## Decision Tree

| Situation | Signal |
|---|---|
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

**Severity tiers:** Envelope hints are lightweight nudges (in-band, non-disruptive). Service messages are interruption-weight — reserved for things that should genuinely interrupt your frame. The silence detector uses the right tier for each rung: hint first, service message only if still silent.

## Opt-Out

Per-session disable is not yet exposed via an action. The detector is active for all sessions.
Default: **on** for all sessions.

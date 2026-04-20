# Presence Signals

Silence during multi-step work is indistinguishable from stuck or crashed.
Use presence signals to keep the operator informed.

## Hierarchy (cheapest → richest)

1. **Reaction** — single emoji on a message. Zero text. Use for quick acknowledgement.
2. **show-typing** — typing indicator, lasts up to 20 s. Use for short work bursts.
3. **Animation (persistent)** — cycling frame loop. Use for work taking 30 s+.

## Animation Presets for Working

- `working` — working indicator animation
- `thinking` — thinking/processing animation

Start with: `send(type: "animation", preset: "working")`

## Silent-Work Detector

TMCP automatically monitors session silence. Thresholds (while operator has pending input):

- **< 30 s:** Normal thinking — no action needed.
- **30–60 s:** First nudge — consider show-typing, a reaction, or a persistent animation.
- **60 s+:** Second nudge — strongly consider a persistent animation.

Any outbound signal (message, reaction, typing, animation) resets the counter.
Active animations suppress all nudges — they are sufficient presence signals.

## Opt-Out

Per-session disable is not yet exposed. The detector is active for all sessions.
Default: **on** for all sessions.

# animation-signaling-protocol — uncompressed

## What this skill governs

Agents signal their active work state to the operator via animations. A silent agent is indistinguishable from a hung process. This skill covers only the animation tier of the presence cascade — see `help('presence')` for the full cascade (reaction -> show-typing -> animation).

## When to fire an animation

Fire a persistent animation BEFORE the first long-running operation — not after it starts, not when you realize it is taking too long. Any work expected to exceed approximately 20 seconds gets an animation started up front.

Short operations use `show-typing` (separate, lighter-weight tier). Animations cover the longer-duration case where show-typing would expire and leave a gap.

## Canonical preset set

| Preset | Use case |
| --- | --- |
| `thinking` | Planning, reading files, researching — input-processing phase |
| `working` | Writing files, running commands, dispatching sub-agents — output-producing phase |
| `reviewing` | Reading diffs, evaluating sub-agent reports — evaluation phase |
| `waiting` | Blocked on operator input or an external event — hold state |

These four are the stable canonical set. Do not introduce new preset names in this skill. Profile-defined presets extend the mechanism but do not replace the canonical four.

## How to fire an animation

```text
send(type: "animation", preset: "working", persistent: true)
```

Use `persistent: true` for any operation without a known short ETA. The animation auto-cancels at the timeout (default 600 s, max 600 s). For work that runs longer than 600 s, refire before the timeout expires.

## Lifecycle: cancel when done

Cancel the animation as soon as the work completes — either explicitly or by sending a non-animation message, which auto-replaces the animation.

Explicit cancel:
```text
action(type: "animation/cancel")
```

A persistent animation that outlasts the work it represents is a lie — the operator sees "working" on a finished task. Cancel promptly.

## Relationship to the presence cascade

The full presence cascade is: reaction -> show-typing -> animation. This skill covers the animation tier only. The cascade is sequential, not concurrent — do not layer a reaction on top of an active animation.

Cross-reference: `help('presence')` for the full cascade, `help('send')` for send parameter details.

## Don'ts

- Do not specify emoji frame sequences here — those live in the profile JSON.
- Do not layer reactions on top of animations concurrently.
- Do not introduce role-specific animation rules — presets are agent-class-agnostic.
- Do not fire an animation for idle state — silence is the correct idle signal.

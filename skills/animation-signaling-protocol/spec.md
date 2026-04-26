# animation-signaling-protocol spec

## Purpose

Define how a Telegram bridge MCP agent signals its current activity state to the operator via animations. A silent agent looks like a hung process; the operator must always be able to see what tier of work is happening without asking.

This skill exists because mute multi-step work (multiple file reads, dispatched subagents, long-running commands) is indistinguishable from a stuck agent without a visible state cue.

## Scope

Applies when an agent is performing work that exceeds a `show-typing` window (~20 seconds) or has no clear ETA. Covers selection of preset, lifecycle (fire/replace/cancel), and overlap with other presence signals (reactions, typing).

Does NOT cover:

- Reaction protocol on inbound messages (separate skill / `help('reactions')`).
- Show-typing signal (separate, shorter-duration tier).
- Modality decisions about voice vs text replies.

## Requirements

R1. The skill MUST enumerate the canonical preset set: `thinking`, `working`, `reviewing`, `waiting`. State the use-case for each in one line.

R2. The skill MUST instruct on lifecycle: animation must be cancelled when the work completes (`action(type: "animation/cancel")` or `send` with non-animation type, which auto-replaces).

R3. The skill MUST state the rule: fire animation BEFORE the first long-running operation, not after. A persistent animation is started up front for any work expected to exceed ~20 seconds.

R4. The skill MUST cover the timeout parameter: animations auto-cancel at the timeout (default 600s, max 600s). Long-running work must extend or refire.

R5. The skill MUST cross-reference `help('presence')` for the full presence cascade (reaction → show-typing → animation) and clarify this skill governs only the animation tier.

## Constraints

C1. Runtime card stays small (~80 lines). The full presence cascade lives in `help('presence')`; this skill is the animation-tier deep dive only.

C2. Preset names are canonical strings — do NOT introduce new presets in this skill. Profile-defined presets are an extension mechanism, but the canonical four are stable.

C3. Use platform-neutral terminology — `animation` not "Telegram emoji frames" or vendor-specific names.

## Don'ts

DN1. Do NOT specify exact emoji frame sequences. Those live in profile JSON; the skill governs the protocol, not the visuals.
DN2. Do NOT instruct agents to layer reactions on top of an animation. The cascade is reaction → typing → animation, not concurrent.
DN3. Do NOT bake workspace-specific role names. Animations are agent-class-agnostic.

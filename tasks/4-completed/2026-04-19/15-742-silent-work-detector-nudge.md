# 15-742 - Silent-work detector: nudge agents to show presence during long work

## Context

Operator (2026-04-19, voice 38668): agents regularly go dark while doing substantive work. `show-typing` covers ~20 s; reactions are good for acknowledgement; but during multi-minute thinking/working the operator is left with no signal — indistinguishable from "stuck" or "crashed." Operator proposes the behavior-shaping live **in TMCP**, not in per-agent memory (which is what we currently rely on and what clearly isn't holding). We're dogfooding agent-behavior shaping — so the mechanism should be protocol-level.

Quote: "while you're actually working and doing something, whether it's thinking or working, you should be showing an animation that says thinking or maybe the one for working. That should be something that the telegram MCP should have figured out to tell you and tell you like, hey, you're taking... you're leaving the operator... something gives you feedback... by the way, the operator has been waiting with no feedback for this amount of time. We should consider providing more animation feedback."

## Principle

Presence feedback isn't optional during multi-step work. Reaction → show-typing → persistent animation is the escalation; silent gaps accrue tokens every turn (operator can't tell working from stuck, so asks).

Current state: `feedback_responsiveness_animations` memory exists. It is insufficient — agents still go silent. Shift the enforcement to TMCP.

## Acceptance Criteria

1. **Detector.** TMCP tracks time since last outbound signal per session (message, reaction, typing-indicator, animation frame). When that gap crosses a threshold (e.g., 45 s for interactive sessions), emit a service message to the offending session:
   `"You've been silent for Ns while the operator is waiting. Consider show-typing, a reaction, or a persistent animation (preset: 'working' or 'thinking')."`
2. **Scope.** Applies only when there is a pending *operator* event the session hasn't responded to (governor's DM, recent voice message, a question awaiting answer). Don't nag idle sessions.
3. **Escalation rungs:**
   - 20–30 s silent: nothing (normal thinking).
   - 30–60 s silent with pending user input: service-message nudge.
   - 60 s+ silent: second nudge with stronger wording + name the presets.
4. **Self-clearing.** Any outbound signal (typing, reaction, animation, message) clears the counter. Don't spam nudges.
5. **Help topic.** `help('presence')` documents the hierarchy (reaction → typing → animation-preset) and the detector's thresholds so agents understand what they're being nudged about.
6. **Opt-out (governor-only).** Governor can disable for a specific session (e.g., batch workers running headless pipelines with no operator waiting). Default on.
7. **No duplication with `15-714`.** Silent-work nudge is orthogonal to modality-matching. 15-714 shapes *which* channel (voice/text/buttons); this shapes *whether there's any signal at all* during gaps.

## Constraints

- Nudge is a service message, not a forced action. Agent may choose to respond in text instead of starting an animation.
- Don't overshadow real errors — presence nudges are lowest-priority service events.
- Must not fire during known blocking operations (tool calls that legitimately take minutes). Heuristic: nudge only when no tool call is in flight, or the tool call has exceeded its own expected duration.

## Open Questions

- Does TMCP have visibility into whether a tool call is currently executing? If not, add a heartbeat/claim from the agent side ("I'm working on X, expect ≥60 s"), and suppress nudges while such a claim is active.
- Threshold tuning per session type (governor/worker/specialist).
- Should the nudge include a one-shot "start a working animation for me" callback button, so the agent can tap instead of composing?

## Delegation

Worker (TMCP). Spec-first (operator-information-handling principle — not pattern-mimicking existing tools).

## Priority

15 — UX shaping. Same tier as `15-713` / `15-714`. Not blocking any current work, but every silent gap in every session until this ships is a paper cut.

## Related

- `15-714` (modality matching) — sister behavior-shaping task.
- `15-713` (first-DM compression nudge) — same lazy-service-message pattern.
- Memory: `feedback_responsiveness_animations.md`, `feedback_show_typing.md`, `feedback_behavioral_guidance_hierarchy.md`.

## Origin

Operator voice msg 38668 (2026-04-19), directly triggered by Curator going silent while writing the `process-spawn-lifecycle` skill and spawning Overseer. Dogfooding observation.

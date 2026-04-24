# 10-750 - Silence-detector refinement: acknowledgement-gap as the only real red flag

## Context

The silence-detector landed in PR #151. Operator reviewed its behavior and clarified the narrow window in which silence is actually meaningful. Most scenarios flagged as "silent agent" are legitimate idle states — we need the detector to distinguish them, and we need agent training materials (startup, skills, service messages) to teach the right response when the detector does fire.

Operator voice 2026-04-20 (paraphrased): "The MCP cannot interpret intent. Agent dequeuing with no activity because there's nothing to do is fine — they're just waiting. The only meaningful red flag is: dequeue-of-a-message followed by silence with no acknowledgement signal (typing, reaction, animation, reply) for ~15–30s. That's the thin window that signals 'user is in the dark about what's happening.'"

## Acceptance Criteria

**Detector behavior:**

1. Silence window opens the moment the agent **dequeues a message** (any content type). It does not open on dequeue-idle-wait (empty queue returning empty/timed_out).
2. Silence window is cleared by the agent emitting **any** acknowledgement signal:
   - `show-typing`
   - any `react` call
   - any animation start (`animation/default`, preset animation)
   - any outbound message on the same session
3. Default silence-detection threshold: **30s** (operator's "30 is where a human starts to wonder"). Floor: 15s. Configurable per-session.
4. When threshold fires, the bridge emits a signal to the agent. Tiering:
   - First fire (per dequeue): **envelope hint** on the next dequeue response: `"silence: N s since last dequeue; operator sees no progress"`.
   - Second fire (no ack still, 2× threshold): **service message** (heavier weight) with the same content plus a reminder of acknowledgement options.
5. Silence timer resets on any ack; it does not accumulate across multiple dequeues.

**Agent-side training (the hard half — docs/help):**

6. Update the presence-related help topic (whichever covers reactions/typing/animations) with the decision tree operator described:
   - Text reply coming → `show-typing` (honest signal; only if text is actually arriving)
   - Thinking required, reply not yet composed → `thinking` animation (temporary; overwritten by next outbound)
   - Long-arriving message the agent needs time to absorb → `processing` preset reaction, then follow-up animation (`thinking` → `working`)
   - Heavy work beginning → `working` animation, OR short ack message ("got it, starting X") then `working`
7. One rule, front-and-center: **`show-typing` is a lie if no text is coming.** Pick the right signal for the modality.
8. Cross-reference the severity tier from 15-748 (envelope hint vs service message) so the two features compose coherently.

## Constraints

- The detector must not fire during dequeue-blocking-wait (empty-queue polling).
- Must not fire during intentional thinking if the agent has already emitted a `thinking` animation or `processing` reaction.
- Ack detection is best-effort: tolerate transient signal loss; don't false-positive on single missed events.
- Do not introduce coercive mechanics (forcing the agent to do anything). The detector informs; the agent decides.

## Priority

10 — this is a product quality feature, directly tied to operator's "perceived responsiveness" theme. Not release-blocking but high-impact.

## Delegation

Worker (TMCP). Paired review with 15-748 (envelope hint tier) — same design surface.

## Related

- PR #151 (where the silence-detector landed as v1)
- 15-748 (envelope hint vs service message severity)
- Memory `feedback_presence_cascade` (show-typing alone = not enough)
- Memory `feedback_animation_honesty` (animations must be factual)
- Memory `feedback_responsiveness_animations` (reaction → typing → animation hierarchy)

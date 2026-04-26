# 15-748 - Envelope hint severity tier + pending-queue nudge

## Context

Operator made two connected points (voice 2026-04-20):

1. **Severity separation** between two existing nudge surfaces:
   - **Service message** carries heavy weight. Reserve for things that should genuinely interrupt the agent's frame (e.g. "you are in forced-stop recovery", "shutdown warned", behavioral corrections).
   - **Envelope hint** is a nudge — a suggestion like "this took a while for you to respond to." Lightweight, in-band, non-disruptive.
   These are already different surfaces in the bridge; the point is to *formalize* the distinction so future additions land at the right tier instead of defaulting to service-message noise.

2. **Pending-queue nudge** (new hint). When the agent dequeues the first of multiple pending messages, the envelope should include a hint along the lines of:

   > "You have N more pending messages. Strongly suggest using the `processing` preset reaction on this one so the operator knows you see the backlog."

   Trigger condition: `pending > 0` on the dequeue response (i.e. more messages waiting after the one just delivered). The hint rides on the first dequeue-with-backlog event and continues to ride subsequent dequeues while `pending > 0`. It disappears when `pending` hits 0.

   Threshold is **>1 pending, not 5** — one extra is enough to warrant the nudge. The specific content (voice vs text) doesn't matter; any backlog warrants the reaction.

## Acceptance Criteria

1. **Severity doc pass**: add a short section to the behavior-shaping framework (or wherever the current service-message vs hint decision lives) that states the severity rule plainly: *service message = interruption-worthy; envelope hint = nudge/suggestion*. One paragraph, concrete examples on each side. Goal: future contributors pick the right tier without asking.
2. **Pending-queue hint**: dequeue response envelope (or the hints array inside it, whichever the current shape is) gains a conditional hint when `pending > 0`. Exact copy TBD — keep it ultra-compressed, one line, action-oriented, e.g. `"pending=N; use processing preset on this message"`.
3. Hint is **per-response** (emitted on every dequeue that returns pending>0); it does not accumulate or repeat within a single dequeue.
4. Hint auto-clears (is simply not emitted) when `pending == 0`.
5. No behavioral coercion — agent may still choose not to react. The hint is a suggestion, not a contract.
6. Update operator-facing presence doc (if any) to mention this.

## Constraints

- This is a TMCP server change — touches the dequeue response builder, not agent prompts.
- Hint must be opt-out-friendly: if future work adds a profile flag to suppress envelope hints, this hint must honor it.
- Do not inflate the envelope: if hints is already an array, append; do not create a new top-level field.
- Do not log the hint (avoid per-dequeue log noise).

## Priority

15 — agent-coherence improvement, not release-blocking. Valuable for perceived responsiveness and for training the processing-preset habit.

## Delegation

Worker (TMCP) after design review. Operator wants the severity-tier formalization paired with the pending-queue hint because they are the same class of improvement (right-sized signal at the right surface).

## Related

- 15-745 (behavioral shaping service message framework — severity rule belongs there or adjacent)
- Memory `feedback_processing_reaction_on_pending` (the behavior the hint is trying to reinforce)
- Memory `feedback_presence_cascade` (adjacent concept — presence signals must chain, not stand alone)
- Memory `feedback_lazy_load_service_msgs` (don't send service messages on session start — same right-sizing principle)

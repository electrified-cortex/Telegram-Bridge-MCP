# 15-714 - Modality-matching behavior shaping (voice begets voice)

## Context

Operator (2026-04-19, applying their own meta-rule about TMCP-layer fixes): when the user voice-messages an agent, that agent should lean toward voice-messaging back. The right shaping point is TMCP, not per-agent memory:

- **Help topic** documenting the principle.
- **Optional service message / hint** reinforcing it at runtime.

Broader principle: agents should match (or weight toward) the user's recent communication modality. If the user has sent N text + M voice in the recent window, the agent's reply distribution should track those proportions.

## Acceptance Criteria

1. **Help topic.** Add or expand a `help('modality')` (or `help('voice')`) topic that explains:
   - User voice-messages -> agent should default to voice + caption hybrid in reply.
   - Quick acks can stay text/reaction; the *substantive* reply matches modality.
   - Track recent N user messages; weight outgoing modality toward observed mix.
2. **Service message (optional, lazy-load):** first time a session receives a voice message in a session, append a one-time service message: "User sent voice -- consider replying with voice or hybrid. See `help('modality')`." Once per session, breadcrumb-style.
3. **No hard rules.** This is shaping, not enforcement. Agents may still text-reply when context warrants (long structured output, code, lists).
4. **Per-target tracking** if feasible: modality preferences may differ between operator and other sessions. If complex, scope to "user-facing only" (sid != target) for v1.

## Constraints

- Don't add bloat to startup-context. Lazy-load via service message + help.
- Service message text under ~200 chars, ASCII-clean.
- Don't penalize text-only sessions — voice is opt-in, not required.

## Open Questions

- Window size for the proportion tracking (last 5? Last 10? Decay function?)
- Should the service message fire only on *unsolicited* user voice (not voice arriving via dequeue after agent already replied)?
- Interaction with `15-713` (first-DM compression service message) — both follow the same lazy-load pattern; consider a unified emitter.

## Delegation

Worker (TMCP). Curator stages, operator merges.

## Priority

15 - UX shaping. Same tier as `15-713`. Not blocking; quality-of-interaction.

## Related

- `15-713` (first-DM compression) - sister behavior-shaping task.
- Memory: `feedback_telegram_voice.md`, `feedback_hybrid_message_caption.md`, `feedback_lazy_load_service_msgs.md`.
- Meta-principle: shape behavior at the protocol layer, not in per-agent memory (per `feedback_behavioral_advice_root_cause.md`).

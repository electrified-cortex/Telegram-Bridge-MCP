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

## Operator refinement (2026-04-19, voice 38209-38211, 38217, 38223-38224)

Decision tree the help topic must encode (operator voice, captured then codified):

### Priority axis (text vs audio vs buttons)

- **Buttons (interactive keyboard)**: highest priority, fastest user response. Binary action; trivial for human regardless of device. Especially on mobile, far less cumbersome than typing. Use whenever the user response is a small set of choices ("yes/no", "this/that/the other", "ack/defer"). Buttons are the most powerful affordance the platform offers; underused.
- **Text**: immediate priority. User reads on arrival. Use for simple acknowledgements ("got it", "done"), notifications, anything that needs the user's eye now. Also use when the response benefits from being skimmable / searchable / quotable / structured.
- **Audio**: lesser priority signal. Audio implicitly says "get to this at your leisure" — user may not be in a position to play it (commute, meeting, headphones unavailable). Use when the *intent* is talk-it-through; comfort, alternate brain modality, narrative explanation. Not for instructions or exposition that needs reading.

The priority distinction is itself signal — sending audio when something is urgent miscommunicates the urgency. Sending a wall of text when the message is meant to be ambient noise miscommunicates the same way in reverse.

### Why audio is NOT instructions

Audio is for the listener brain — the part that processes language by sound. Reading aloud silently to "hear" the words is humans approximating what audio gives directly. The benefit is comfort and alternate processing, NOT additional content. If audio is just "the same instructions but spoken," delete it (this echoes the hybrid-anti-pattern in `15-713`). Use audio when the listener brain genuinely benefits — narrative, walkthrough, conversational tone — not when the message is a checklist or a directive.

### Modality-matching emphasis

Operator audio-messages most of the time. Agent reply distribution should track that — if you read this and reply only in text, you've already drifted from the rule. The default is hybrid (audio + brief text label) when the user is voice-messaging.

### Implementation notes for help-topic and service-message text

These should be encoded into the `help('modality')` (or rolled into `help('audio')` per `15-713`) so they're discoverable. Service message at first user-voice arrival should explicitly mention buttons as the fastest channel — not just "consider audio". Buttons being underused is the bigger leverage than voice-vs-text alone.

## Related

- `15-713` (first-DM compression) - sister behavior-shaping task.
- Memory: `feedback_telegram_voice.md`, `feedback_hybrid_message_caption.md`, `feedback_lazy_load_service_msgs.md`.
- Meta-principle: shape behavior at the protocol layer, not in per-agent memory (per `feedback_behavioral_advice_root_cause.md`).

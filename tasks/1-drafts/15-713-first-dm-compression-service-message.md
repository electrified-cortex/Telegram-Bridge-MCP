# 15-713 - First-DM service message: teach ultra-compression by example

## Context

Operator (2026-04-19): when an agent DMs another session for the first time in a session, TMCP should emit a service message reminding them to use ultra-compression for inter-agent communication, with `help('compression')` as the breadcrumb. After receiving the service message once, the agent self-regulates for the rest of the session.

This is the broader pattern of behavior shaping at the protocol layer rather than per-agent memory. Lazy-load the rule when it becomes relevant (first DM), don't bloat startup-context with rules that may never apply.

## Acceptance Criteria

1. **Trigger:** first time a session emits `send` with `type: "dm"` (or any inter-session DM path) within a session.
2. **Service message** appended to that session's next dequeue:
   - Short, ASCII-clean: "Inter-agent DMs should use ultra-compression. See `help('compression')` for the framework. Operator-facing messages are full-tier; agent-facing are ultra-tier."
   - `event_type: "compression_hint_first_dm"` (or similar — pick a stable event type for telemetry).
3. **Once per session.** Don't re-emit on subsequent DMs in the same session.
4. **No effect on operator-facing `send`.** This is strictly for inter-session DMs.

## Constraints

- Service message text stays under ~200 chars. Brevity is part of the lesson.
- `help('compression')` topic must exist (it does per recent compression-as-talent work; verify before shipping).
- Don't piggyback on the unrenderable-chars warning system — separate event_type.

## Open Questions

- Should this also fire on the first `message/route`? Probably yes, same intent.
- Per-session or per-target-pair? Per-session is simpler; per-target-pair more pedagogical. Default: per-session.

## Delegation

Worker (TMCP). Curator stages, operator merges.

## Priority

15 - behavior shaping. Not blocking, but fixes a recurring "agent DMs are too long" friction.

## Existing help-topic state (audited 2026-04-19)

`help('compression')` exists and has reasonable surface map but conflicts with the refined operator rules and needs updating. `help('audio')` does NOT exist as a topic. `help('send')`'s "Hybrid" section codifies the OLD pattern ("voice = full detail, caption = TL;DR") which is now the explicit anti-pattern.

**Refinements required:**

1. **`help('compression')`:** keep surface map. Update audio row from "None" → "Audio form" (codified below). Update caption row to specify "topic label or non-overlapping payload only — never restate audio."
2. **`help('audio')`:** add as new topic. Source content from this task's "Voice / audio" section above.
3. **`help('send')` Hybrid section:** rewrite. Old "voice = full detail, caption = TL;DR" is wrong; replace with the two-pattern model (long-audio+brief-label, short-audio+long-structured-payload) and the duplication anti-pattern.
4. **Discoverability at startup:** any new agent instance should encounter the audio/compression rules early enough to apply them. Either via `help('startup')` cross-link or via the per-modality first-use service messages (this task + `15-714`).

## Source content for `help('compression')` (operator voice 2026-04-19)

The compression help topic must distinguish modality-by-modality. Operator's spec, captured verbatim then codified:

### Text

- Default channel. Always acceptable.
- **Brief until it needs to be long.** This is a chat, not a research session. Humans don't want to read tomes.
- Lean **inquisitive**: exchange shape, not monologue. Ask a question, get an answer, ask the next.
- **Use buttons** for back-and-forth. Question/choose/confirm carry the conversation faster than prose.

### Voice / audio (has its own compression form -- codify explicitly)

- Excellent when sent to operator. Best when in plain English (or operator's working language).
- **Not over-compressed.** Light tier at most. Audio compression is a different form than text compression -- text compresses by deleting words; audio compresses by being structurally fluid, not by being terse.
- **Fluid, conversational.** Not choppy. Not punchy. Not bullets. The listener should be able to unpack effortlessly.
- Use audio when the *intent* is to talk through something -- explain, narrate, walk through context. Not when the intent is structured information transfer (use text + buttons for that).

### Inter-agent DM (where this task's service message fires)

- Ultra-tier compression. Maximum density, minimum prose.
- This is the channel that warrants the protocol-level service message because it's the easiest to overshoot.

### Hybrid (audio + text)

Two valid patterns. Both produce more value than either modality alone.

1. **Long fluid audio + brief caption.** Audio carries a comfortable, plain-language explanation. Caption is a short topic label so the operator can glance and decide whether to play. *The caption summarizes the topic, not the content.*
2. **Short audio + long structured text.** Audio carries a quick orientation ("here's what's in the breakdown"). Text carries the detailed checklist, table, or structured payload that needs to be skimmed/searched.

**The anti-pattern, hard rule:** never send the same content as the audio in the caption. Duplication wastes tokens, period.

- **Even paraphrased duplication is a fail.** Same content with one version verbose and the other brief is still duplication.
- **Why it doesn't help:** Telegram has built-in audio-to-text transcription for users who want it. Re-stating the audio in the caption is reinventing a feature the platform already ships.
- The caption's job is something the audio cannot do (topic label, structured payload, link, callback). If the caption is just text-form audio, delete it.

## Related

- Memory: `feedback_compression_as_talent.md`, `feedback_lazy_load_service_msgs.md`, `feedback_telegram_voice.md`, `feedback_hybrid_message_caption.md`.
- Architectural cousin: any future "first-time-X-do-Y" service messages follow the same lazy-load pattern.
- `15-714` (modality matching) - sister; both feed the same `help` topic family.

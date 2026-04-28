# Guidance Delivery Reference

Guidance fires just before it becomes relevant — not all at once at session start.

## Trigger Taxonomy

| Trigger | Guidance delivered | Event type |
| --- | --- | --- |
| Session start | Identity (session_orientation) | `session_orientation` |
| Session start | Token save reminder (onboarding_token_save) | `onboarding_token_save` |
| Session start | Governor/role context (onboarding_role) | `onboarding_role` |
| Session start | No-pending notice (onboarding_no_pending_yet) | `onboarding_no_pending_yet` |
| First operator message received | Communication protocol — typing, reactions, voice auto-salute (onboarding_protocol) | `onboarding_protocol` |
| First operator message received | Modality priority — buttons > text > audio (onboarding_modality_priority) | `onboarding_modality_priority` |
| First operator message received | Presence signals — show-typing, animation, silence threshold (onboarding_presence_signals) | `onboarding_presence_signals` |
| First non-DM send | Hybrid messaging — long-audio caption rules (onboarding_hybrid_messaging) | `onboarding_hybrid_messaging` |
| First reaction | Reaction semantics — 👌 vs 👍 vs 🫡 (behavior_nudge_reaction_semantics) | `behavior_nudge_reaction_semantics` |
| First `confirm/` action or `send(type:"question", choose/options)` use | Button/choice protocol — confirm, choose, ask (onboarding_buttons) | `onboarding_buttons` |
| First user voice message received | Modality hint — consider voice reply (modality_hint_voice_received) | `modality_hint_voice_received` |
| First DM sent | Compression hint (compression_hint_first_dm) | `compression_hint_first_dm` |
| First message/route | Route compression hint (compression_hint_first_route) | `compression_hint_first_route` |
| First send(type:"choice") | choice vs question:choose distinction | `_first_use_hint` (tool result) |
| First send(type:"question",choose) | blocking vs non-blocking | `_first_use_hint` (tool result) |
| First send(type:"progress") | progress update/close guidance | `_first_use_hint` (tool result) |
| First send(type:"checklist") | checklist step update guidance | `_first_use_hint` (tool result) |
| First send(type:"animation") | ephemeral, must cancel explicitly | `_first_use_hint` (tool result) |
| First send(type:"append") | in-place growth, 3800 char limit | `_first_use_hint` (tool result) |
| After 5 sends, typing rate < 30% | Typing rate nudge | `behavior_nudge_typing_rate` |
| 2 consecutive slow dequeue gaps | Slow gap nudge | `behavior_nudge_slow_gap` |
| First actionable question without buttons | Button hint | `behavior_nudge_question_hint` |
| 10th actionable question without buttons | Button escalation | `behavior_nudge_question_escalation` |
| Hybrid send, audio ≈ caption | Caption duplication nudge | `behavior_nudge_caption_duplication` |
| Silence ≥ threshold after dequeue | Presence hint (rung 1, lightweight) | `hint` field on dequeue response |
| Silence ≥ 2× threshold after dequeue | Presence service message (rung 2) | `behavior_nudge_presence_rung2` |

## Notes

- Guidance that fires once is tracked per-session in memory (not persisted across sessions).
- All service messages appear as `updates` items on the next `dequeue` call.
- Envelope hints (`_first_use_hint`) appear only in the tool result JSON, not in the session queue.
- Behavior nudges (threshold-driven) count against the per-session cap of 5 (`MAX_NUDGES_PER_SESSION`).
- Lazy onboarding messages (protocol, modality, presence, hybrid, buttons) do NOT count against the behavior nudge cap — they use the first-use-hints tracking mechanism.
- For the full behavior rule table, see `help("behavior")`.

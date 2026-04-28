---
id: 10-0823
title: First-dequeue onboarding bundle — load-bearing service messages, conditional tail
priority: 10
status: draft
type: behavior-shaping
delegation: any
---

# First-dequeue onboarding bundle

The very first dequeue a new session ever performs should return the complete set of onboarding service messages as a single bundle. Today the bundle works, but additional behavior nudges (`behavior_nudge_first_message`, `modality_hint_voice_received`) only fire reactively — after the agent has already violated the rule. Move them upfront so the agent enters context with full protocol awareness, not corrective slaps.

## Goal

Load-bear behavior shaping at the bridge level, not at the memory level. Once the protocol is in the agent's first dequeue context, the agent doesn't repeat the bad pattern. Memory-only feedback wastes tokens for every agent that comes online and re-learns the same lesson individually.

> Operator: "If we can feed you the beginning service message to get you aligned, it only happens once in your context and then you get used to it. And then you typically won't repeat the pattern if it's bad."

## Behavior

### First dequeue (ever, for this session)

Returns the **complete** onboarding bundle as service messages, in this order:

1. `session_orientation` — your SID, sole/governor status (already exists)
2. `onboarding_token_save` — save your token (already exists)
3. `onboarding_role` — governor routing protocol (already exists)
4. `onboarding_protocol` — show-typing, reactions, voice auto-salute (already exists)
5. `onboarding_buttons` — buttons over typing, confirm/question types (already exists)
6. **NEW** `onboarding_hybrid_messaging` — hybrid send rules: long audio + brief topic label OR short audio + long structured payload, never restate audio in caption. Reference `help('audio')`.
7. **NEW** `onboarding_modality_priority` — buttons > text > audio priority axis. Match user modality. Reference `help('modality')`.
8. **NEW** `onboarding_presence_signals` — presence cascade: react on receipt → show-typing for short work → **animation for work that exceeds show-typing's window** (~20s) or has no clear ETA. >30s silence with no escalation is a violation. Reference `help('presence')`.

   Operator stated rule: "you took too long to identify presence here. You could have done that through eyes and through the processing reaction or you could have done probably an animation for thinking." Show-typing alone is not enough when the work runs long — escalate to animation BEFORE show-typing's timeout expires.

Anything that's currently a reactive `behavior_nudge_*` for first-violation should be considered for promotion to onboarding. Reactive nudges remain for mid-session drift.

### Conditional tail

After the bundle, check whether the queue contains any operator-originated content (user messages, reactions). If **none**:

`onboarding_no_pending_yet` — "No operator messages yet. Call `dequeue` again to wait." This guides the agent into the wait loop instead of leaving it ambiguous.

If user content already queued (e.g. session reconnected with backlog), skip this tail — the operator content guides the agent.

## Out of scope

- Reactive nudges (`behavior_nudge_first_message`, `behavior_nudge_slow_gap`, etc.) stay as-is for mid-session corrections. The first-dequeue bundle reduces *first-time* violations; reactive nudges still catch drift.
- No changes to dequeue API. This is purely about what the queue contains immediately after `session/start`.

## Why now

Today's evidence (this session's startup, 2026-04-25):
- I had `onboarding_protocol` in my first-dequeue bundle telling me to show-typing before reply.
- I went straight to Bash on the first operator voice message anyway.
- `behavior_nudge_first_message` fired *after* the violation, bundled with the operator's worried follow-up.
- Operator asked: "was that not clear from service messages?" — yes, it was clear, I missed it.

The reactive nudge worked but cost the operator a "uh oh, everything ok?" cycle. Pre-emptive bundling closes the gap.

Same pattern then repeated for hybrid-message duplication: I doubled audio + caption content. Memory had the rule; bridge didn't enforce. Operator's stance: load-bearing fix is at the bridge level, not in memory.

Third instance same session: started a release-branch task, set show-typing for 20s, work ran longer, no animation escalation. Operator: "you took too long to identify presence here. You could have done that through eyes and through the processing reaction or you could have done probably an animation for thinking." Adds to the case for putting presence-cascade rules in the first-dequeue bundle.

## Reactive nudge gap (related, distinct fix)

The existing silence-detector (v7.1.0, rung-1 at 30s, rung-2 at 60s) resets on ANY outbound signal — send, typing, animation, reaction, confirm. So a sequence of show-typing + small reactions + small sends reads as "active" to the detector even when the agent has been working on the same long task for minutes without an animation. The detector measures *output cadence*, not *escalation*.

Operator on this same gap: "I'm actually surprised that you haven't read any service messages that would have told you, hey, you probably should do something to let the user know yet. Is that a failure of our presence protocol or what we're doing to try to help agents be more present?"

Yes — protocol gap. Suggested companion fix (separate spec or extension here, TBD):

- Track `lastAnimationAt` per session in addition to `lastOutboundAt`.
- If `now - lastAnimationAt > 45s` AND the session has emitted ≥ 3 short signals (typing/react/edit) without an animation, fire `behavior_nudge_animation_escalation` — "long-running work detected, consider animation/preset:'thinking' or 'working'".
- Suppress for sessions that are clearly done (no operator content pending, queue empty).

This is companion to the onboarding bundle: bundle teaches the rule once at startup; reactive nudge catches drift mid-session.

## Acceptance criteria

- New onboarding service messages added with stable `event_type` strings.
- First-dequeue test verifies the full bundle is returned in order.
- Conditional tail test: empty operator queue → tail message present; populated queue → tail absent.
- Existing `onboarding_*` event_types unchanged (backward compat for any consumers).
- `help` topics referenced in new messages exist and are current.

## Open questions

- Should `onboarding_hybrid_messaging` and `onboarding_presence_signals` be conditional on TTS being configured / on operator preference? Probably no — universal rules.
- Order: does protocol-then-modality-then-hybrid read better than alphabetical or grouped? Probably yes (current proposal).

## Related

- `00-ideas/15-0822-hybrid-duplication-detector.md` — algorithmic detector for caption/audio duplication; complementary, fires reactively when the onboarding rule is forgotten.
- `help(topic: 'modality')`, `help(topic: 'audio')`, `help(topic: 'presence')`

## Completion

Added 3 new onboarding service messages (`onboarding_hybrid_messaging`, `onboarding_modality_priority`, `onboarding_presence_signals`) + conditional tail (`onboarding_no_pending_yet`) to `src/service-messages.ts`. Injected in both first-session and second-session paths in `src/tools/session/start.ts`. Tail gated on `discarded === 0` — suppressed when operator messages were already in queue at session-start. Added tests covering delivery, conditional suppression (backlog present → tail absent), and reconnect filter cleanup. All 2837 tests pass. Branch: `10-0823` off `dev`.

---
type: friction
status: idea
filed-by: Curator
date: 2026-05-05
---

# Service message `behavior_nudge_typing_rate` over-fires show-typing

## Observation

Service message text:

> "Show-typing after receiving messages. help('show-typing')"

This reads as "fire show-typing on every received message." Operator caught Curator firing show-typing on every Monitor wake / message receipt and corrected:

> "Just because you received a message, you immediately call show typing — that's wasted because you're not actually typing. You should only show typing when you're actually going to type something. You should definitely dequeue the message and then do something afterwards."

## Root issue

`show-typing` is a *composition-imminent* signal, not a generic acknowledgement. The current nudge wording conflates three different presence concerns:

1. **Reception ack** — "I got your message" → reaction on the message id.
2. **Composition signal** — "I'm typing the reply right now" → show-typing.
3. **Background-work signal** — "I'm working, no immediate reply" → animation preset.

The current nudge collapses all three into "show-typing on receipt," producing knee-jerk typing indicators during silent file reads, dispatches, or background investigation when no reply is imminent.

## Proposed fix (TMCP-side)

Re-word the nudge to disambiguate. Draft:

> "Acknowledge receipt with a reaction. Show-typing only when about to compose a reply. Use an animation preset for background work with no imminent reply. help('presence')"

Or split into three nudges that fire in different contexts (receipt, mid-work, pre-reply).

## Related

- `feedback_monitor_wake_presence_signal.md` (Curator memory) — corrected presence cascade.
- onboarding `onboarding_presence_signals` already says it correctly; only `behavior_nudge_typing_rate` is miscalibrated.

## Bailout

If TMCP team disagrees, document the corrected interpretation in agent-side memory and treat the nudge as advisory only. Already done on Curator side.

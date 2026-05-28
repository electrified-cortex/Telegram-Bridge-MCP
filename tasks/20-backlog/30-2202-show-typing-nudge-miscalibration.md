---
Created: 2026-05-05
Status: backlog
Priority: medium
Source: operator voice 2026-05-05; Curator observation
---

# Service message `behavior_nudge_typing_rate` over-fires show-typing

## Problem

The `behavior_nudge_typing_rate` service message text currently reads: "Show-typing after receiving messages." Agents interpret this as: fire `show-typing` on every message receipt. Operator correction: show-typing is a composition-imminent signal only, not a generic acknowledgement.

Three presence concerns are conflated in one nudge:
1. Reception ack — "I got your message" → react on message id.
2. Composition signal — "I'm typing the reply right now" → show-typing.
3. Background-work signal — "I'm working, no immediate reply" → animation preset.

The existing `onboarding_presence_signals` topic already says it correctly; only the `behavior_nudge_typing_rate` text is miscalibrated.

## Acceptance Criteria

- [ ] `behavior_nudge_typing_rate` service message text is reworded to disambiguate the three presence concerns.
- [ ] New text makes clear: show-typing fires only when a reply is about to be composed.
- [ ] Reactions are named as the correct reception-ack tool.
- [ ] Animation presets are named as the correct background-work signal.
- [ ] Updated text is consistent with `onboarding_presence_signals`.
- [ ] No change to the trigger logic — only the message copy changes.

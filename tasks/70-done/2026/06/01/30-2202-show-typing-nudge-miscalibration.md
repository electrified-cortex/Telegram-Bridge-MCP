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

- [x] `behavior_nudge_typing_rate` service message text is reworded to disambiguate the three presence concerns.
- [x] New text makes clear: show-typing fires only when a reply is about to be composed.
- [x] Reactions are named as the correct reception-ack tool.
- [x] Animation presets are named as the correct background-work signal.
- [x] Updated text is consistent with `onboarding_presence_signals`.
- [x] No change to the trigger logic — only the message copy changes.

## Overseer review
- reviewer: Overseer SID-3
- date: 2026-06-01
- verdict: PASS
- review type: adversarial dispatch
- checked: ACs binary (single constant at confirmed line, 4 specific content requirements, consistency check, no logic change), single-file scope, target confirmed

## Verification

- **Verdict:** APPROVED
- **Date:** 2026-06-01
- **Verifier:** dispatched sub-agent (read-only)
- **Squash commit:** `1ba42da` on `dev`
- **Worker commit:** `fc79c016` on `worker/30-2202-show-typing-nudge-miscalibration`
- **Test evidence:** 3279/3279 tests pass (142 files), tsc clean
- **New text:** `"show-typing = reply imminent (composition starting). React to ack receipt; animation preset for background work. help('show-typing')"`
- **Consistent with:** `onboarding_presence_signals` (react→show-typing→animation order)

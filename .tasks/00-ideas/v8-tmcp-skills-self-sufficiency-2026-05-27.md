---
captured: 2026-05-27
source: operator voice (Telegram, msg 62566)
---

# V8 Architectural Constraint: TMCP Skills Must Be Self-Sufficient

## Operator directive (distilled)

The operator noted that Telegram skills could be reduced and cleaned up, and that some could be framed as sub-agent dispatch patterns. However, TMCP cannot assume the consuming agent has access to any external skill library — consumers may not have electrified-cortex skills installed. Skills should be self-contained or reference external patterns only as optional enhancements.

## Key constraint

- TMCP skills must be self-contained — no dependency on electrified-cortex stations skills
- Cannot assume consumer has sub-session-dispatch, reminder-driven-followup, or any stations skill installed
- Can reference those patterns as optional enhancements, but cannot require them
- Sub-agent dispatch = good idea to mention, not to mandate

## Implication for V8

- Skills should read cleanly without cross-repo prerequisites
- Any patterns borrowed from stations must be inlined or footnoted as "if you have X installed"
- Skills are the primary documentation surface — must work standalone

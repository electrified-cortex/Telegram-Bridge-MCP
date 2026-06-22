---
captured: 2026-05-27
source: operator voice (Telegram, msg 62566)
---

# V8 Architectural Constraint: TMCP Skills Must Be Self-Sufficient

## Operator statement (verbatim)

"Some of the Telegram skills could be very much reduced and cleaned up. And then even some of them could be done as a sub-agent dispatch as well. You know, it would be a good idea. But again, whoever's using Telegram MCP has to know about the sub-agent dispatching as best they can. They might not. We can frame it that way, but we can't expect them to have our electrified cortex skills installed. So..."

## Key constraint

- TMCP skills must be self-contained — no dependency on electrified-cortex stations skills
- Cannot assume consumer has sub-session-dispatch, reminder-driven-followup, or any stations skill installed
- Can reference those patterns as optional enhancements, but cannot require them
- Sub-agent dispatch = good idea to mention, not to mandate

## Implication for V8

- Skills should read cleanly without cross-repo prerequisites
- Any patterns borrowed from stations must be inlined or footnoted as "if you have X installed"
- Skills are the primary documentation surface — must work standalone

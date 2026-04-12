---
Created: 2026-04-12
Status: Draft
Host: local
Priority: 10-497
Source: Operator directive (dogfooding critique)
---

# 10-497: Tutorial mode — first-call hints

## Objective

Implement a tutorial mode where tools return one-time educational hints
the first time an agent calls them in a session. Subsequent calls omit
the hint. Reduces the need to front-load the guide while ensuring agents
learn tool patterns organically.

## Context

Currently agents must read the guide (32KB) or help topics to learn
tool conventions. A fresh agent that skips the guide will make common
mistakes (wrong dequeue pattern, missing drain, voice-without-text, etc).

Tutorial hints solve this by teaching at point-of-use:
- First `dequeue()` call → hint about drain/block pattern, pending field
- First `send()` call → hint about audio+text combo, voice-first preference
- First `action(type: 'dm')` call → hint about routing, target_sid
- etc.

Operator context: "tutorial mode — hints that only show up the first time
a tool is called."

## Design

### Storage

Per-session seen-tools set. In-memory only (resets on session close).
No persistence needed — tutorials repeat on fresh sessions, which is fine.

### Hint delivery

Add an optional `tutorial` field to tool responses:

```json
{
  "result": { ... },
  "tutorial": "Tip: call dequeue(timeout: 0) to drain pending messages before blocking."
}
```

Agents that care can read it. Agents that don't can ignore it.
Does NOT replace the tool's normal response.

### Hint content

Define hints as a static map: tool name → first-call hint text.
Keep each hint to 1-2 sentences. Actionable, not explanatory.

### Toggle

- **ON by default** for all sessions — this is the expected state
- Disable via config only: `tutorial: false` in TMCP server config or agent profile
- Agent can also disable runtime: `action(type: 'tutorial/off')`
- Agent can re-enable: `action(type: 'tutorial/on')`
- Profile loading can override (experienced agents set `tutorial: false`)
- No other way to control it — if you don't configure it, you get tutorials

### Reaction hints

Special tutorial trigger: first time a human reacts to an agent message,
inject a hint: "Reactions from humans are acknowledgements — they don't require
a response or action unless the context makes it explicit."

## Acceptance Criteria

- [ ] First call to each tool returns a `tutorial` field with a hint
- [ ] Second and subsequent calls omit the `tutorial` field
- [ ] Hint tracking is per-session, in-memory only
- [ ] `tutorial/off` action disables hints for the session
- [ ] `tutorial/on` action re-enables hints
- [ ] Profile loading can set tutorial preference
- [ ] Hints defined for at least: dequeue, send, action (DM), confirm, choose
- [ ] Hint text is ≤2 sentences, actionable
- [ ] Normal tool response is unchanged (tutorial is additive)

## Notes

- This is a medium-lift feature. The hint map is the real design work.
- Consider: should `help()` mention tutorial mode? Probably yes.

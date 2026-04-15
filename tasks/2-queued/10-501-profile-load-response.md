---
Created: 2026-04-12
Status: Draft
Host: local
Priority: 10-501
Source: Operator directive (dogfooding critique)
---

# 10-501: Ultra-compressed profile/load response

## Objective

Make `profile/load` response ultra-compressed and actionable. Replace
opaque reminder hex IDs with a categorized count and a hint to
`reminders/list`.

## Context

Current response dumps 9 hex reminder IDs with no labels, intervals, or
descriptions. Agent has zero insight into what's scheduled.

Operator directive: "Say something simple like 'voice: onyx 1.1×.
1 startup + 5 recurring reminders active. → reminders/list for details.'"

Design principle: every hint leads to a help call or relevant tool.

## Proposed Response Format

```
voice: onyx 1.1×. 5 animation presets. N startup + M recurring reminders active.
→ help('reminders') for reminder docs. reminders/list for details.
```

Ultra compression — agents are the audience, not humans.

## Acceptance Criteria

- [ ] Profile/load response omits raw reminder hex IDs
- [ ] Response includes categorized reminder count (startup vs recurring)
- [ ] Response includes voice/speed summary
- [ ] Response includes hint to `reminders/list` for details
- [ ] Response uses ultra compression (no articles, fragments OK)
- [ ] All hints lead to a help call or relevant tool

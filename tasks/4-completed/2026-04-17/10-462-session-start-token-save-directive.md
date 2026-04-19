---
Created: 2026-04-10
Status: Subsumed by 10-494
Host: local
Priority: 10-462
Source: Operator directive
---

# 10-462: Include token-save directive in session/start response

## Objective

When an agent calls `action(type: "session/start")`, the response should include
a message directing the agent to persist its token for compaction recovery.

## Context

Agents lose their auth token after context compaction. The recovery flow requires
reading the token from session memory. Currently, agents must know to save the token
from their own spec — the server doesn't prompt them.

Adding a directive in the session/start response makes the expectation explicit and
reduces compaction recovery friction across all agent types.

## Proposed Message

The `session/start` response hint must use this **exact canon text**:

```text
Save this token. Read: help(topic: 'session/started')
```

This is the first instruction any agent receives. It must be unambiguous and
actionable. "Save this token to session memory" is the canonical phrasing —
not "persist," not "ensure," not "store." Exact words.

## Acceptance Criteria

- [ ] `session/start` response hint uses the exact canon text above
- [ ] Hint directs to `help(topic: 'session/started')` as the next step
- [ ] Token-save directive is first sentence, help reference is second
- [ ] Existing session/start behavior is unchanged (no regression)
- [ ] Directive text references "token" (not "PIN" or "SID")

## Notes

- Token is opaque to agents — the directive should not explain token composition
- This is a UX/friction improvement, not a security change

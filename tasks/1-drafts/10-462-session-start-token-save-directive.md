---
Created: 2026-04-10
Status: Draft
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

Include in the `session/start` response payload:

```text
Ensure your token is saved to memory to recover from compaction.
```

## Acceptance Criteria

- [ ] `action(type: "session/start")` response includes a token-save directive message
- [ ] Message appears in both fresh start and reconnect flows
- [ ] Existing session/start behavior is unchanged (no regression)
- [ ] Directive text references "token" (not "PIN" or "SID")

## Notes

- Token is opaque to agents — the directive should not explain token composition
- This is a UX/friction improvement, not a security change

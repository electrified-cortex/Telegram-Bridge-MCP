---
Created: 2026-04-10
Status: Backlog
Host: local
Priority: 25-466
Source: Operator
---

# 25-466: Warn last session on close — suggest shutdown instead

## Problem

If the last remaining session calls `session/close`, the server silently
closes it. The agent may not realize they should have called `shutdown`
instead (governor duty). This happened when Curator accidentally closed
its own session instead of shutting down the server.

## Proposed Behavior

When `session/close` is called and the calling session is the **only
remaining session**, the server should:

1. Reject the close
2. Return a warning: "You are the last active session. Use `action(type: 'shutdown')` to shut down the server, or pass `force: true` to close anyway."
3. Accept `session/close` with `force: true` as an override

## Acceptance Criteria

- [ ] `session/close` from last session returns warning instead of closing
- [ ] Warning message suggests `shutdown` action
- [ ] `force: true` parameter overrides the guard
- [ ] Normal close behavior unchanged when other sessions exist

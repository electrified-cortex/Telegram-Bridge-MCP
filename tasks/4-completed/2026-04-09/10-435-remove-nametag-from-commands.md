---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 10-435
Source: Operator testing session
---

# Remove Name Tag from Built-in Command Responses

## Objective

Built-in bot command responses (`/logging`, `/voice`, `/version`, `/session`) are showing the active session's name tag (e.g. "🟦 Curator") prepended to the response message. These are system/service messages from the bridge itself — they should not carry any session name tag.

## Context

- The bridge prepends `[color] [name]` to outgoing messages from agent sessions.
- Built-in commands are handled by `built-in-commands.ts` (or similar) and use `sendMessage` which goes through the same header-stamping logic.
- The operator click `/voice` and sees "🟦 Curator" at the top — confusing because the voice selector is a bridge feature, not something the Curator sent.
- Commands should either use `_skipHeader: true` in their sendMessage calls, or the header logic should recognize built-in command responses and skip tagging.

## Acceptance Criteria

- [ ] `/logging` response has no session name tag
- [ ] `/voice` response has no session name tag
- [ ] `/version` response has no session name tag
- [ ] `/session` response has no session name tag
- [ ] All built-in command responses render as system messages (no session attribution)
- [ ] Agent-initiated messages still retain their name tags as before
- [ ] Existing tests pass

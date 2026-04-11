---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 10-426
Source: Dogfood test 10-404, row 99
---

# get_chat missing from v6 action routing

## Objective

Add an action path for `get_chat` functionality. Currently there is no way to
access chat info (chat ID, title, type) through the 4-tool v6 API.

## Context

Dogfood row 99: The old `get_chat(token)` tool returned Telegram chat metadata.
No v6 action path maps to this functionality. Help still lists `get_chat` as a
tool but it's not accessible through `action()`.

## Acceptance Criteria

- [ ] `action(type: "chat/info")` or similar returns chat metadata
- [ ] Response includes: chat_id, title, type, username (where applicable)
- [ ] `help` lists the new action path

---
Created: 2026-04-10
Status: Queued
Host: local
Priority: 10-447
Source: Worker friction report — startup skill references stale v5 tools
---

# Update startup skill and API guide for v6 action() discoverability

## Objective

Fix stale references in the startup skill and improve discoverability of the
v6 `action()` dispatcher so agents don't miss it during onboarding.

## Context

Workers reported two friction points during API testing:

1. `telegram-mcp-session-startup/SKILL.md` tells agents to call `get_me` to
   verify bot reachability, but v6 has no standalone `get_me` tool. The guide
   says `action(type: "history/chat")` instead.

2. The v6 unified `action()` dispatcher isn't obvious without reading the full
   guide. Agents assuming familiarity with v5 skip it and try calling
   deprecated tool names.

## Acceptance Criteria

- [ ] Startup skill: replace `get_me` reference with `action(type: "history/chat")` or equivalent v6 call
- [ ] Startup skill: add a callout that v6 uses `action()` as the unified dispatcher
- [ ] API guide: add a "Quick Start" or "First 3 Calls" section near the top
- [ ] Verify no other skills reference deprecated v5 standalone tools

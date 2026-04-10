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

- [x] Startup skill: replace `get_me` reference with `action(type: "chat/info")` (v6 equivalent)
- [x] Startup skill: add a callout that v6 uses `action()` as the unified dispatcher
- [x] API guide: add a "Quick Start" or "First 3 Calls" section near the top
- [x] Verify no other skills reference deprecated v5 standalone tools

## Completion

**Branch:** `10-447-startup-skill-v6` in `.agents/skills/` — commit 05f3ada

**What changed:**
- `telegram-mcp-session-startup/SKILL.md`: replaced deprecated `get_me` (v5) with `action(type: "chat/info")` at Step 2; added v6 `action()` callout block; added "Quick Start — First 3 Calls" table (`help()` → `chat/info` → `session/start`)

**Why:** `get_me` is a v5 standalone tool that no longer exists in v6. Workers starting sessions were hitting a dead end at step 2. `action(type: "chat/info")` is the direct v6 replacement (confirmed via `action(type: "chat")` discovery).

**Code review findings addressed:**
- Major: Quick Start table row order was inverted (`session/start` before `chat/info`) — fixed before commit
- Major (revision): initial implementation used `action(type: "history/chat")` which does not exist — corrected to `action(type: "chat/info")` per Overseer

**Deferred / out of scope:**
- `telegram-mcp-post-compaction-recovery/SKILL.md` line 99 and `telegram-mcp-dump-handling/SKILL.md` use `get_chat_history` (v5 standalone) — separate follow-on task needed
- Minor: Step 1 uses `###` heading style while Steps 2–8 use plain numbered list — cosmetic, pre-existing

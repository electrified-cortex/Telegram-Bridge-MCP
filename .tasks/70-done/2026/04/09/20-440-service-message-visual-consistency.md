---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 20-440
Source: Operator testing session
---

# Service Message Visual Consistency

## Objective

Service messages (built-in command responses, menus, system notifications) need consistent visual branding. Currently there's inconsistency: some have emojis, some don't; some say "Telegram Bridge MCP" at the top, some don't; name tags leak into system responses.

## Context

Operator feedback:
1. **Emoji rule:** If one button/item has an emoji, all should. "All or nothing."
2. **Branding:** Service messages should be clearly distinguishable from agent chat — maybe a consistent header emoji or style, but not necessarily "Telegram Bridge MCP" on everything.
3. **Title emoji:** Menus and system messages should have an emoji in their title line for visual scannability.
4. **Related:** 10-435 handles the name tag leaking specifically. This task covers the broader visual consistency.

## Acceptance Criteria

- [ ] All service message menus follow consistent emoji treatment (all buttons have emoji, or none do)
- [ ] Service messages have a recognizable visual style distinct from agent messages
- [ ] Menu titles include an emoji for visual scanning
- [ ] No agent session name tags appear on service messages (verify with 10-435)
- [ ] Existing tests pass

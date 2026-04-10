---
Created: 2026-04-09
Status: Complete
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

- [x] All service message menus follow consistent emoji treatment (all buttons have emoji)
- [x] Service messages have a recognizable visual style distinct from agent messages (`_skipHeader: true` added to session panel)
- [x] Menu titles include an emoji for visual scanning (`🖥` added to session list title)
- [x] No agent session name tags appear on service messages (verified — 10-435 handled command responses; `_skipHeader: true` added to session `sendMessage`/`editMessageText` back action)
- [x] Existing tests pass

## Completion

- **Branch:** `20-440`
- **Commit:** `7c37e7d`
- **Files changed:**
  - `src/built-in-commands.ts` — `/logging` OFF state: `"On"` → `"✓ Enable"`; ON state: `"Dump"` → `"💾 Save log"`, `"Off"` → `"✗ Disable"`, `"Flush (N)"` → `"🗑 Clear (N)"` split into 2×2 rows; flush confirm: `"No — Cancel"` → `"✖ No — Cancel"`, `"Delete All"` → `"🗑 Delete All"`. Session list panel: added `_skipHeader: true` to `sendMessage` and back-navigation `editMessageText`; title updated to `"🖥 Active sessions — tap one to manage:"`.
- **Tests:** 2166/2166 passing

---
Created: 2026-04-03
Status: Draft
Priority: 15
Source: Operator directive (voice)
Epic: Bot API 9.6
Repo: electricessence/Telegram-Bridge-MCP
Branch target: dev
Depends: 10-192
---

# 15-193: Managed Bots — MCP Tool Integration

## Epic Context

Part of the **Bot API 9.6 epic**. This is the highest-value feature — programmatic
bot provisioning enables fleet management from the bridge. See full analysis in the bridge repo research docs.

Related tasks: 10-192 (prerequisite), 15-195 (architecture)

## Goal

Expose Telegram's Managed Bots API as MCP tools in an **opt-in mode**. The
current single-bot multi-session architecture remains the default. Managed bots
support is an optional mode that users can enable for fleet-level Telegram bot
isolation — each agent gets its own bot identity — without breaking the existing
setup.

**Design constraint:** The bridge must work identically with managed bots disabled.
Enabling managed bots mode adds capabilities but doesn't change existing behavior.

## Bot API 9.6 — Managed Bots Surface

### New API Methods
- `getManagedBotToken` — retrieve token for a managed bot
- `replaceManagedBotToken` — rotate a managed bot's token
- `savePreparedKeyboardButton` — pre-save keyboard buttons for managed bots

### New Types
- `KeyboardButtonRequestManagedBot` — keyboard button that creates managed bots
- `ManagedBotCreated` — service message when a managed bot is created
- `ManagedBotUpdated` — update type for managed bot state changes

### New Deep Links
- `t.me/newbot/{manager}/{suggested}` — deep link to create a managed bot

## Proposed MCP Tools

| Tool | Description |
| --- | --- |
| `get_managed_bot_token` | Retrieve token for a bot managed by this instance |
| `replace_managed_bot_token` | Rotate token for a managed bot |
| `request_managed_bot` | Send a keyboard button that prompts bot creation |

## Design Questions

1. **Opt-in mechanism:** Configuration flag (env var? constructor option?) to
   enable managed bots mode. When disabled, managed bot tools are not registered
   and managed bot updates are ignored.
2. **Token storage:** Where do managed bot tokens live? In-memory only, or
   persisted? Security implications of storing bot tokens.
3. **Multi-bot sessions:** Should managed bots get their own session manager
   instances? Or share the parent's poller/store?
4. **Update routing:** How to handle `ManagedBotUpdated` — new update type in
   the poller? New event type in `dequeue_update`?
5. **Authorization:** Who can call `get_managed_bot_token`? Only the governor?
   Only specific SIDs?
6. **Graceful coexistence:** If managed bots mode is enabled, do existing
   single-bot sessions continue working? Can the same bridge serve both
   managed and unmanaged bots simultaneously?

## Acceptance Criteria

- [ ] `get_managed_bot_token` tool implemented and tested
- [ ] `replace_managed_bot_token` tool implemented and tested
- [ ] `ManagedBotCreated` service message handled in poller
- [ ] `ManagedBotUpdated` routed as event in `dequeue_update`
- [ ] Token security: no tokens logged or exposed in error messages
- [ ] Agent guide updated with managed bot workflow

## Reversal Plan

Remove new tool files and undo poller changes. No data migration needed — new
feature, no existing state to preserve.

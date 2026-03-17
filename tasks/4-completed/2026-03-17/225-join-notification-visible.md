# Feature: Remove Redundant Join DM

## Type

Refinement

## Priority

225

## Description

When a second session joins, the server sends a DM to existing sessions:
`📢 🤖 {name} has joined. You'll coordinate incoming messages.`

This uses `deliverDirectMessage()` — an internal queue event only the agent sees.

This DM is **completely redundant**. The new session's intro message (sent via
`bot.sendMessage()` at line 173) is a visible Telegram message that gets picked up
by the poller and routed to all existing sessions through normal `dequeue_update`.
Existing agents already learn about the new session from seeing that intro message
appear in their dequeue stream.

No replacement message needed — just remove the DM.

## Files

- `src/tools/session_start.ts` — lines 204-212, remove the `deliverDirectMessage`
  loop entirely

## Acceptance Criteria

- [ ] `deliverDirectMessage` call for join notification removed
- [ ] No replacement message — agents learn about new sessions from the intro message
- [ ] Tests updated (remove any tests asserting the join DM)
- [ ] `deliverDirectMessage` import removed if no longer used in this file

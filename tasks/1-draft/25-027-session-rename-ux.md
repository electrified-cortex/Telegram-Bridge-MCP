# Task #027: Session Rename UX Improvements

**Priority:** 25 | **Status:** Draft

## Problem

When an agent calls `rename_session`, the confirmation dialog shows the bot's name in the Telegram header rather than the requesting session's nametag. Additionally, the rename is only visible to the operator — other sessions don't know a rename occurred.

## Requirements

1. **Nametag attribution** — The rename confirmation message should display the requesting session's name/color, not the bot's identity
2. **Broadcast notification** — After a successful rename, emit a broadcast service message visible to all sessions: "Session N renamed to [new_name]"
3. **Message cleanup** — Either update the original session announcement message to reflect the new name, or delete it and re-emit

## Scope

- `rename_session` tool handler
- Service message emission
- Session announcement message management

# 010 — Session Identity Change Authorization

**Priority:** 20
**Status:** Backlog

## Problem

Sessions can currently rename themselves or change their color without any user approval. This is a security/trust issue — a rogue agent could impersonate another session or change its identity without the operator knowing.

## Requirements

- `rename_session` must require **user confirmation** (via Telegram button) before the rename takes effect.
- Color changes (if exposed as a tool) must also require user confirmation.
- The session requesting the change should not be able to approve its own request — only the **operator** (Telegram user) can approve.
- If the operator denies, the change is rejected and the session is notified.

## Implementation Notes

- Add an approval flow: tool sends a confirmation button to the operator, blocks until approved/denied.
- Consider using the existing `confirm` pattern but routed to the operator rather than the requesting session.
- Governor sessions should also require approval — no exceptions.

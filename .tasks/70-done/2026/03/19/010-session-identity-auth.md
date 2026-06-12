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

- This is a **system-level** action — the confirmation is sent by the server, not by the agent. The agent calls `rename_session` or a color-change tool, and the server intercepts it and sends a confirmation button to the operator.
- Use inline keyboard buttons sent by the bot (system), not the `confirm` tool pattern.
- The requesting session's tool call should block until the operator approves or denies.
- If denied, return an error result to the calling session.
- Governor sessions should also require approval — no exceptions.

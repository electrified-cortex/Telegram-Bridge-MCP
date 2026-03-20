# 004 — Governor Selection Command

**Type:** Feature
**Priority:** 20 (high — improves multi-session UX)
**Status:** Queued

## Goal

Add a `/governor` slash command that lets the operator pick which session is the governor at runtime.

## Behavior

- **Only visible when 2+ sessions are active.** The command auto-registers when a second session joins and unregisters when the session count drops to 1.
- Shows an explanatory message first: _"The governor receives ambiguous messages and decides how to route them. Choose which session should be the governor:"_
- Shows inline keyboard buttons listing all active sessions by name/color. Current governor is marked (e.g., "🟦 Overseer ✓").
- Operator taps a session → that session becomes the new governor.
- The old governor and new governor both receive service messages about the change.
- All other sessions receive a service message noting the governor has changed.

## Implementation Notes

- Register as a built-in command (like `/voice`, `/help`).
- Use `setGovernorSid()` from `routing-mode.ts`.
- Dynamic command registration: hook into `session_joined` / `session_closed` events to register/unregister the command.
- The command handler sends an inline keyboard, waits for callback, processes the selection.
- No MCP tool needed — this is operator-only, via Telegram slash commands.

## Worktree

Create worktree `20-004-governor-command` from the current branch.
Branch: `task/004-governor-command`

## Acceptance Criteria

- [ ] `/governor` command appears only when 2+ sessions exist
- [ ] Shows all active sessions as buttons
- [ ] Tapping a session promotes it to governor
- [ ] All sessions notified of the change via service messages
- [ ] Command disappears when back to single session
- [ ] Tests cover promotion, notification, and dynamic registration

# 590 — Governor Selection Command

**Priority:** 900 (Low / Super Backlog)
**Source:** Operator request (voice, 2026-03-22)

## Goal

Allow the operator to forcibly pick which session is the governor via a slash command or panel.

## Notes

- Could be a built-in command (`/governor`) or an MCP tool
- Helps the operator understand multi-session hierarchy naturally
- Current governor assignment is implicit (first session or via session_start)
- This would make it explicit and controllable at runtime

# Task #003 — Status Page / Session Status Command

**Priority:** 30 (Medium)  
**Source:** Operator request

## Goal

Provide a way for both agents and humans to query session status — which sessions are active, how long each has been queued/running, current state, etc.

## Options

- **Slash command** (`/status`): built-in command that shows a panel with session status (similar to `/session` or `/voice` panels)
- **MCP tool** (`get_status`): returns structured JSON — useful for agent-to-agent coordination
- **Both**: slash command for humans, MCP tool for agents

## Information to expose

- Active sessions: SID, name, state (queued / active / draining)
- Queue time: how long a session waited before getting a slot
- Uptime: how long each session has been active
- Server uptime
- Pending updates count per session

## Notes

- Consider whether this should be a built-in command (always present) or an agent-registered command
- May overlap with `list_sessions` tool — evaluate whether to enhance that instead

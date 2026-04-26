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

## Activity Log

- 2026-04-24: Worker 3 claimed task. Pre-flight: audited `session/list`, `Session` interface, action routing. Decided against slash command (existing `/session` panel covers humans) and against modifying `session/list` (would break callers). New `session/status` action is additive.
- 2026-04-24: Impl subagent created `src/tools/session_status.ts` + registered in `action.ts`. Build clean.
- 2026-04-24: Code Reviewer — 2 majors (governor-0 edge case, race filter for getSession miss), 3 minors (spurious async, NaN guard, missing is_governor field), 2 nits. All fixed. Second build clean.

## Completion

- Branch: `30-003`
- Commits: `74d16e1` (impl), `1005585` (review fixes)
- New file: `src/tools/session_status.ts`; modified: `src/tools/action.ts`
- Returns per-session: sid, name, color, createdAt, uptime_s, last_poll_s, is_waiting, waiting_s, healthy, is_governor
- Governor sees all sessions; non-governor sees own only
- Subagents: Impl ×1, Code Reviewer ×1
- Ready for Overseer merge.

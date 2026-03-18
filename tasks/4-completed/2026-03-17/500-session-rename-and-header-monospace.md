# Feature: Session Rename

## Type

Feature

## Found During

Multi-session manual testing (2026-03-18)

## User Quote

> "Can we have name reservation/rename as long as no one else has it?"

## Description

Allow an active session to change its name after creation via a new `rename_session` tool. The name collision guard (already implemented in `session_start`) must also apply to renames — reject if another active session already has the requested name.

## Current Behavior

- Name is set once at `session_start` via the `name` parameter
- Name collision is checked at session creation time only
- No way to change name after creation

## Proposed Behavior

- New tool: `rename_session` (requires identity `[sid, pin]`)
- Validates new name is not taken by another active session
- Updates the session's name in `_sessions` map
- Returns `{ sid, old_name, new_name }`
- Error `NAME_TAKEN` if collision

## Additional Items

### Monospace Name in Header

The session name in the outbound header should use monospace formatting:

- Plain: ``🤖 `Scout` ``
- MarkdownV2: `🤖 \`Scout\`\n`

This makes session names visually distinct from message content when multiple agents are posting.

## Acceptance Criteria

- [ ] `rename_session` tool with identity gate
- [ ] Name collision rejected with `NAME_TAKEN` error
- [ ] Empty/whitespace name rejected
- [ ] `list_sessions` reflects new name immediately
- [ ] Outbound header uses new name after rename
- [ ] Header name in monospace (both plain and MarkdownV2)
- [ ] Tests for rename, collision, and concurrent rename race

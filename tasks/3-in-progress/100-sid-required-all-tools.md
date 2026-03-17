# Feature: SID Required on All Tools

## Type

Feature / Safety

## Description

When multiple sessions are active, SID must be required on **every** tool call — not just `dequeue_update`. Currently only `dequeue_update` enforces `SID_REQUIRED` when `activeSessionCount() > 1`. The remaining 36 tools silently fall back to `getActiveSession()`, which is a race condition when two agents share a server process.

## User Quote

> "It's not optional. For any messages now, nothing is ever optional."

## Current State

**Already enforced (2 patterns):**

- `dequeue_update` — explicit `sid` parameter (optional), returns `SID_REQUIRED` error when omitted with `activeSessionCount() > 1` (commit `aa2006b`)
- 5 session-auth tools — use `SESSION_AUTH_SCHEMA` (requires `sid` + `pin`): `close_session`, `pass_message`, `request_dm_access`, `route_message`, `send_direct_message`

**Not yet enforced (37 tools):**

`answer_callback_query`, `append_text`, `ask`, `cancel_animation`, `choose`, `confirm`, `delete_message`, `download_file`, `dump_session_record`, `edit_message`, `edit_message_text`, `get_agent_guide`, `get_chat`, `get_debug_log`, `get_me`, `get_message`, `list_sessions`, `notify`, `pin_message`, `send_chat_action`, `send_choice`, `send_file`, `send_message`, `send_new_checklist`, `send_new_progress`, `send_text`, `send_text_as_voice`, `session_start`, `set_commands`, `set_default_animation`, `set_reaction`, `set_topic`, `show_animation`, `show_typing`, `shutdown`, `transcribe_voice`, `update_progress`

## Code Path

1. `src/session-manager.ts` — `activeSessionCount()` returns `_sessions.size` (L81)
2. `src/session-auth.ts` — `SESSION_AUTH_SCHEMA` defines `sid`/`pin` Zod fields; `checkAuth(sid, pin)` validates via `validateSession()`
3. `src/tools/dequeue_update.ts` — reference implementation of `SID_REQUIRED` gate (L72-80)
4. Each tool file in `src/tools/*.ts` — `register(server)` calls `server.registerTool()` with `inputSchema`

## Design Decisions

### Which tools need SID?

**All tools** when `activeSessionCount() > 1`. No exceptions. Even read-only tools like `get_me` and `list_sessions` need to know who's asking for logging and attribution.

### Authentication method

Two tiers:

1. **Session-auth tools** (cross-session operations): keep `SESSION_AUTH_SCHEMA` with `sid` + `pin`. These are: `close_session`, `pass_message`, `request_dm_access`, `route_message`, `send_direct_message`
2. **All other tools**: add `sid` as an optional parameter (like `dequeue_update`). When `activeSessionCount() > 1` and `sid` is omitted, return `SID_REQUIRED` error. When only 1 session is active, `sid` is gracefully ignored.

### Why not `SESSION_AUTH_SCHEMA` everywhere?

`SESSION_AUTH_SCHEMA` requires the PIN, which is heavyweight for every single tool call. The SID-only approach is sufficient — the PIN was designed for cross-session trust (e.g., closing someone else's session), not for "which session am I?"

### Implementation pattern

Extract the gate logic from `dequeue_update.ts` into a shared helper:

```typescript
// src/session-gate.ts (new file)
export function requireSid(sid: number | undefined): ErrorResult | number {
  if (sid !== undefined) return sid;
  if (activeSessionCount() <= 1) return getActiveSession();
  return toError({ code: "SID_REQUIRED", message: "..." });
}
```

Then in each tool handler: `const resolvedSid = requireSid(args.sid); if (isError(resolvedSid)) return resolvedSid;`

## Acceptance Criteria

- [ ] All 37 unenforced tools add `sid` as an optional parameter
- [ ] All 37 tools return `SID_REQUIRED` error when `sid` omitted and `activeSessionCount() > 1`
- [ ] All 37 tools work unchanged when only 1 session is active (backward compat)
- [ ] Shared `requireSid()` helper extracted — no copy-paste of the gate logic
- [ ] Test for each tool: multi-session + no sid → `SID_REQUIRED`
- [ ] Test for each tool: single session + no sid → works normally
- [ ] Test for each tool: multi-session + valid sid → works normally
- [ ] All tests pass: `pnpm test`
- [ ] No new lint errors: `pnpm lint`
- [ ] Build clean: `pnpm build`

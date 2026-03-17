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

All gated tools carry a single `identity` field — a `[sid, pin]` tuple.
One field, two numbers, zero ambiguity.

**Schema:** `identity: z.tuple([z.number().int(), z.number().int()]).optional()`
**On the wire:** `{ "identity": [1, 809146], ... }`

- **Single-session mode** (`activeSessionCount() <= 1`): `identity` is optional.
  When omitted, falls back to `getActiveSession()` (backward compat).
- **Multi-session mode** (`activeSessionCount() > 1`): `identity` is required.
  - Omitted → `SID_REQUIRED` error.
  - Provided but PIN wrong/session not found → `AUTH_FAILED` error.
  - Valid → resolved SID returned.

> **Previous designs (both superseded):**
> 1. SID-only on most tools, PIN only on cross-session tools.
> 2. Separate `sid` + `pin` params on every tool.
> Current: single `identity` tuple, universal except exempt tools.

### Implementation pattern

```typescript
// src/session-gate.ts
export function requireAuth(
  identity: [number, number] | undefined,
): number | TelegramError {
  if (activeSessionCount() <= 1) return getActiveSession();
  if (!identity) return { code: "SID_REQUIRED", message: "..." };
  const [sid, pin] = identity;
  if (!validateSession(sid, pin)) return { code: "AUTH_FAILED", message: "..." };
  return sid;
}
```

In each tool handler:

```typescript
async ({ identity, ...rest }) => {
  const _sid = requireAuth(identity);
  if (typeof _sid !== "number") return toError(_sid);
  // ... rest of handler uses _sid
}
```

## Exempt Tools

`session_start`, `shutdown`, `get_agent_guide`, `get_me`, `list_sessions`

## Acceptance Criteria

- [ ] All 32 gated tools add `identity: z.tuple([z.number().int(), z.number().int()]).optional()` as a schema field
- [ ] All gated tools return `SID_REQUIRED` when `identity` omitted and `activeSessionCount() > 1`
- [ ] All gated tools return `AUTH_FAILED` when `identity` provided but PIN invalid
- [ ] All gated tools work unchanged when only 1 session is active (backward compat)
- [ ] Exempt tools have no `identity` field and no gate
- [ ] Shared `requireAuth(identity)` helper in `src/session-gate.ts` — no copy-paste gate logic
- [ ] Test: multi-session + no identity → `SID_REQUIRED`
- [ ] Test: multi-session + wrong pin → `AUTH_FAILED`
- [ ] Test: multi-session + valid identity → works normally
- [ ] Test: single session + no identity → works normally
- [ ] All tests pass: `pnpm test`
- [ ] No new lint errors: `pnpm lint`
- [ ] Build clean: `pnpm build`

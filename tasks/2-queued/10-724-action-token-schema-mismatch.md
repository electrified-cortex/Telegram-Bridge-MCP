# 10-724 - action.ts token schema description contradicts auth model

## Context

GPT-5.4 audit (2026-04-19): `action.ts:230` says the token is required for **all paths except `session/start` and `session/reconnect`**, but `session/list` is intentionally **token-optional** (per `list_sessions.ts:9` — supports unauthenticated SID-only probe).

This is the kind of mismatch that causes agents to either avoid valid recovery flows or cargo-cult the wrong auth assumptions.

## Acceptance Criteria

1. Update the `token` description in `action.ts` (line 230 area) to enumerate **all** token-optional paths, not just `session/start` / `session/reconnect`.
2. Audit any other paths that may also be token-optional and add them.
3. Verify the new wording is internally consistent with `list_sessions.ts:9` and any other unauthenticated handlers.
4. Same fix should propagate to `send.ts` token description if it exists (the `mcp__telegram-bridge-mcp__send` tool has a similar token field with similar wording).

## Constraints

- Schema description text only — don't change the actual auth enforcement.
- Keep wording terse (schema descriptions appear in agent tool lists).

## Priority

10 - active footgun for any agent attempting recovery flows.

## Related

- 20-721 (parent V7 merge readiness audit).
- 10-723 (related help/action surface drift).

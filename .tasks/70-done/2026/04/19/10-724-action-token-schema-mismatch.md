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

## Activity Log

- **2026-04-19** — Pipeline started. Variant: Implement only.
- **2026-04-19** — [Stage 4] Task Runner dispatched. 1 file changed (action.ts). send.ts audited — unchanged (inherits correct description via identity-schema.ts).
- **2026-04-19** — [Stage 5] Verification: tsc PASS. lint/test skipped — Overseer approved (no node_modules in worktree; description-only change).
- **2026-04-19** — [Stage 6] Code Reviewer iter 1: 2 major (TOKEN_PARAM_DESCRIPTION stale, send.ts inherits wrong desc). Task Runner iter 2 fixed both. Code Reviewer iter 2: 1 major (discovery clause in shared constant pollutes 40+ tools). Task Runner iter 3 removed discovery clause from TOKEN_PARAM_DESCRIPTION. Code Reviewer iter 3: 1 major (action-path framing in shared constant still pre-existing scope). Overseer ruling: revert identity-schema.ts entirely — TOKEN_PARAM_DESCRIPTION structural issue is separate task. action.ts + send.ts verified correct.
- **2026-04-19** — [Stage 7] Complete. Branch: 10-724, commit: a9fd840. Ready for Overseer review.

## Completion

Fixed the token schema description mismatch identified in the GPT-5.4 audit.

**Changes:**
- `action.ts`: token description now enumerates all token-optional paths — `session/start`, `session/reconnect`, `session/list` (unauthenticated probe returns SIDs only), and discovery/category-listing mode (omitting `type`).
- `send.ts`: added explicit `.describe()` override stating token is required for all send paths. Previously inherited `TOKEN_PARAM_DESCRIPTION` which listed action-specific exceptions inapplicable to send.

**Subagent passes:** Task Runner ×3, Code Reviewer ×3.
**Final review verdict:** 0 critical, 0 major, 1 minor (Tier 2 discovery coverage — dropped per Overseer, out of scope).
**Note:** `TOKEN_PARAM_DESCRIPTION` structural issue in `identity-schema.ts` deferred to a separate task.

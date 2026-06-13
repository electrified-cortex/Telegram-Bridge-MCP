# 10-723 - help.ts content drift from actual v7 behavior

## Context

GPT-5.4 audit (2026-04-19) found three places where `help.ts` advertises behavior that no longer matches the implementation. First-contact agents will be misled.

## Findings

1. **`help.ts:54` and `help.ts:55`** — help description still advertises `startup` and `quick_start` as primary topics. Content is now routed through `start`.
2. **`help.ts:80`** — `list_sessions` is described only as "List all active sessions with their SIDs and display names," but `list_sessions.ts:9-10` explicitly supports an **unauthenticated SID-only probe**. This is a meaningful capability omission.
3. **`help.ts:129`** — `approve_agent` says approval is "by name," but `approve_agent.ts` is **ticket-based**.

## Acceptance Criteria

1. For each of the three locations, update the description string to match the live tool contract.
2. Where feasible, derive the description from the tool's own metadata (single source of truth) instead of duplicating; otherwise update the literal string.
3. Run `pnpm test` → still green.

## Constraints

- Don't broaden scope to a full help-system rewrite — only fix the three drifts called out.
- If single-source-of-truth refactor is non-trivial, do the minimal string fix now and file a separate task for the refactor.

## Priority

10 - active footgun. Stale help text mis-trains every new agent on first contact.

## Related

- 20-721 (parent V7 merge readiness audit).
- 15-713 (first-DM compression service message — same theme of help-surface accuracy).

## Completion

Implemented three targeted string fixes in `src/tools/help.ts` on branch `10-723` (commit `cea2180`):

1. `DESCRIPTION` lines 54–55: collapsed `'startup'` and `'quick_start'` into single `'start'` entry with alias note — matches TOPIC_ALIASES routing.
2. `TOOL_INDEX[list_sessions]`: added unauthenticated SID-probe capability, derived from `list_sessions.ts` DESCRIPTION.
3. `TOOL_INDEX[approve_agent]`: corrected "by name" → "by ticket" with delivery-mechanism note, matching `approve_agent.ts`.

Build: passed. Lint/test: blocked (pnpm install hook-denied — escalated to Overseer). Code review: no critical/major issues; two minor pre-existing out-of-scope drifts noted for follow-up.

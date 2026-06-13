# 20-727 - Update "v6 API" branding in action.ts to v7

## Context

GPT-5.4 audit (2026-04-19): `action.ts:207` still describes itself as the "Universal action dispatcher for v6 API" even though the branch is now at 7.0.0 and the PR is explicitly a v7 release. Public-facing API description should not advertise the prior major version.

## Acceptance Criteria

1. Update the description string in `action.ts` (around line 207) from "v6 API" to "v7 API."
2. Search the rest of the codebase for any other "v6" branding in user-facing descriptions, schema text, help topics, or README — bring along any stragglers.
3. Confirm `package.json` version is `7.0.0` (sanity).

## Constraints

- Don't rewrite changelog entries that legitimately describe historical v6 behavior.
- Description text only; don't rename internal types or files just to scrub "v6."

## Priority

20 - branding hygiene; ship-blocker only in the sense that "v6 API" in v7 release docs looks careless.

## Related

- 20-721 (parent V7 merge readiness audit).

# 15-726 - Finish docs/behavior.md -> guide.md rename cleanup

## Context

GPT-5.4 audit (2026-04-19): `docs/behavior.md` was renamed to `docs/guide.md` and `server.ts` now serves the new path, but several files still reference the old path. This creates broken navigation in onboarding docs and weakens the release record.

## Stale References

1. `agent-setup.md:124` — points readers to `docs/behavior.md`.
2. `unreleased.md:148` — changelog entry says "Updated docs/behavior.md and LOOP-PROMPT.md for v6 tool names."
3. `CLAUDE.md:7` — also references `docs/behavior.md`.
4. `telegram-communication.instructions.md:27` — also references `docs/behavior.md`.

## Acceptance Criteria

1. For each of the four files, replace `docs/behavior.md` with `docs/guide.md` (or the equivalent `help(topic: 'guide')` form where contextually appropriate).
2. For the changelog entry (`unreleased.md:148`), rewrite to mention the rename explicitly so future audits understand the path history.
3. Search the rest of the repo for any other `behavior.md` references and bring them along (one consolidated cleanup).
4. Verify `server.ts` actually serves `docs/guide.md` and not both — confirm there's no dead `behavior.md` route still wired.

## Constraints

- Don't touch git history — the rename happened, just chase the references.
- Don't add a redirect from `behavior.md` to `guide.md` unless operator explicitly asks; make it a clean rename.

## Priority

15 - documentation drift. Not a blocker but compounds confusion if left.

## Related

- 20-721 (parent V7 merge readiness audit).

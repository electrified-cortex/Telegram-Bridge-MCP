# 10-0892 — Backfill v7.x git tags as Worker dogfood

## Priority

10 (low — no rush per operator 2026-05-10)

## Context

v7 releases (v7.0.0, v7.0.1, v7.1.0, v7.2.0, v7.2.1, v7.2.2, v7.3, v7.4) all
shipped via PR merge to master but no git tags were created. Latest
tag is v5.0.1 despite codebase being on v7.4.1. v7.4.1 itself was
tagged manually 2026-05-10 from Curator.

Operator (2026-05-10): "Get our new worker to do it when everything
is dialed in. We can use that as our dogfood."

## What's wanted

Backfill annotated git tags for each missing v7.x release by
identifying the corresponding `release: vX.Y.Z` merge commit on
master and tagging it with appropriate notes. Push tags. Optionally
create GitHub releases pointing at each tag.

## Acceptance criteria

- v7.0.0, v7.0.1, v7.1.0, v7.2.0, v7.2.1, v7.2.2, v7.3, v7.4 each
  have an annotated tag at the corresponding release merge commit
  on master.
- Tags pushed to origin.
- Optional: GitHub releases created with notes summarized from the
  release commit body or PR description.

## Why this is dogfood

The task is bounded, mechanical, well-defined, and operates on a
single repo — ideal first real run for the ephemeral Worker once
the engineering chain (specs + skills) is dialed in. Single
worktree, no external state, deterministic outcome.

## Notes

- Filed 2026-05-10 from Curator session.
- Source commits to tag (one per version) — Curator can list at
  hand-off time:
  - v7.0.0 → f0a1f703 (#136)
  - v7.0.1 → 5701d007 (#151)
  - v7.1.0 → 8b012d8a (#155)
  - v7.2.0 → e8e019dc (#158)
  - v7.2.1 → fc952828 (#160)
  - v7.2.2 → 9866cfbd (#161)
  - v7.3 → 4747c989 (#164)
  - v7.4 → fd635289 (#167)
- v7.4.1 already tagged manually by Curator (ab1d4139).

---
id: "10-0892"
title: "Backfill v7.x git tags as Worker dogfood"
type: chore
priority: 30
status: draft
created: 2026-05-10
repo: electrified-cortex/Telegram-Bridge-MCP
agent_type: Worker
model_class: sonnet-class
delegation: Worker
branch: master
---

# 10-0892 — Backfill v7.x git tags as Worker dogfood

## Priority

30 (low — no rush per operator 2026-05-10)

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

## Overseer bounce (2026-06-01)
- verdict: REJECT — spec is a planning note, not executable
- finding: No delegation assignment. "Tags pushed to origin" requires push access (violates sandbox). Optional GitHub releases AC is inside the AC block making definition-of-done ambiguous.
- action: Add delegation, remove push-to-origin AC (sandbox can't push), clarify optional vs required ACs.

## Refinement notes (2026-06-20)

**Current tag state:** v7.4.1, v7.6.0, v7.6.1 exist. Still missing: v7.0.0-v7.3, v7.5.x, v7.7.x-v7.11.x.

**Scope adjustment (Workers cannot push):**
- Worker task: create local annotated tags at correct commits (verify each commit is the right release merge)
- Push step: explicitly Foreman-gated or operator step — NOT worker AC

**Commit hash list incomplete:** The Notes section only has hashes for v7.0.0-v7.2.2. Curator must provide hashes for v7.3, v7.5.x, v7.7.x-v7.11.x before this can be dispatched.

**Blocking gap:** This task needs Curator to complete the commit hash list before it can be promoted to 40-queued.

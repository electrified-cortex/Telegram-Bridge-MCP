---
id: 20-0841
title: Spike — pre-stage node_modules in TMCP worktrees to remove pnpm-install Worker friction
priority: 20
status: draft
type: spike
delegation: any
needs: research findings + recommended approach for operator decision
---

# Spike — pre-stage node_modules in TMCP worktrees

## Friction (the why)

Every new TMCP worktree currently needs `pnpm install --frozen-lockfile` before a Worker can run `pnpm test` or `pnpm build`. Workers cannot edit `package.json` (supply-chain safety policy), so installs fall to Overseer or operator. Result: one round-trip per task, every task. Compounds across the fleet.

## Goal

Identify mechanisms to make the worktree usable for build+test from the moment it is created, without giving Workers package-modification authority.

## Investigation scope

For each candidate, document: how it works, security posture, compatibility with `pnpm` workspace + `frozen-lockfile`, disk-cost impact, lifecycle (when does the staging refresh).

Candidates to consider:

1. **Symlink shared `node_modules`** — single canonical install, all worktrees symlink into it.
2. **Hardlink-based copy** — Overseer pre-stages a copy at worktree-create time.
3. **`pnpm` store reuse** — `pnpm` already shares the store; investigate whether worktree creation can hit the existing store without a fresh install round.
4. **Worktree-create hook** — Overseer (or claim script) runs install automatically as part of worktree creation, abstracting the round-trip.
5. **CI-style cache restore** — pre-staging a node_modules tarball restored on worktree create.
6. **Skip — accept current friction** — document the trade-off if no solution clears the security bar.

## Out of scope

- Granting Workers `package.json` write authority. The supply-chain risk is the original reason for the policy.
- Investigating non-pnpm package managers (TMCP is pnpm-canonical).

## Acceptance criteria

- [ ] Findings document at `tasks/10-drafts/spike-results-node-modules-prestaging.md` (or attached to this task).
- [ ] Each candidate has: mechanism description, pros/cons, security posture, recommended use-cases.
- [ ] Top recommendation surfaced with rationale.
- [ ] Operator decision noted (defer to operator at end of spike).

## Lessons / context

- `feedback_pnpm_install_audit` — Curator memory. Workers must NOT install or run pnpm without supervised review.
- TMCP is canonical pnpm; node_modules has native bindings on Windows that may complicate symlinks (Z-Wave-style native deps less common but TMCP has some).
- Worktrees on Windows have known issues with locked DLLs in node_modules during cleanup — see `feedback_pnpm_rebuild_cadence_policy` (workspace).

## Related

- `friction-pnpm-install-worktree-block.md` (filed by Overseer 2026-04-25/26).

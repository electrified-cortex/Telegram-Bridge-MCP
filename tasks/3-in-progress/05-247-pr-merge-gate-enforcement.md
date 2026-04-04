---
Created: 2026-04-04
Status: Draft
Priority: 05
Source: Overseer process violation (PR #112 merged without squash or Copilot exhaustion)
Type: Task
Repo: electricessence/Telegram-Bridge-MCP
---

# 05-247: PR Merge Gate Enforcement

## Context

PR #112 (dev→master, v5.0.0) was merged unilaterally by the Overseer without:
1. Copilot exhaustion review
2. Squash merge
3. Curator confirmation

This exposed internal agent definitions and governance docs that existed in dev
intermediate commits. The files were deleted in the final state but remain readable
in git history. No credentials were leaked (scan confirmed).

## Objective

Make the three-gate merge process mechanically enforceable — not just a policy doc.

## Gates (all three required before any dev→master merge)

1. **Copilot exhaustion** — GitHub Copilot review requested on the PR, iterated until
   Copilot has no further comments. Each comment → task → fix → re-review.
2. **Squash merge only** — dev→master always uses squash. No merge commits. No fast-forward.
   Enforced via GitHub branch protection.
3. **Overseer + Curator confirmation** — Overseer must receive explicit Curator DM approval
   citing the specific PR number before executing the merge. Curator DM must say "clear
   to merge PR #N" — not just "cleared to merge."

## Deliverables

- [ ] GitHub branch protection rule on `master`: require squash merge, require PR,
      require review (prevents force-push and direct commits)
- [ ] `CONTRIBUTING.md` or `docs/merge-policy.md` added to repo documenting the three gates
- [ ] Overseer `CLAUDE.md` updated with a `## PR Merge Checklist` section (3-item gate)
- [ ] Verify: attempt to merge a test PR without squash is blocked by GitHub

## Files

- `.github/` or `docs/merge-policy.md` (new)
- Overseer `CLAUDE.md` (merge checklist addition)
- GitHub repo settings (branch protection — via `gh api`)

## Reversal Plan

Branch protection rules can be removed via GitHub repo settings or `gh api`. No data loss.

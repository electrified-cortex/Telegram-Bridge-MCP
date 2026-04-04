# PR Merge Policy

Gates 1 and 2 are required before any PR is merged to master. Gate 3 (Curator review) is strongly recommended — skip it only when the Curator is unavailable, and proceed directly after gates 1 and 2 are confirmed. Gate 4 (Documentation Audit) is mandatory before tagging any release and recommended for PRs that add or change user-facing behavior.

## Gates

1. **Copilot exhaustion gate** — request a GitHub Copilot code review on the PR. Copilot leaves inline comments. Fix each comment, push, and request another Copilot review. Repeat until Copilot has no remaining comments. Only then proceed to the next gate.

2. **Squash-only gate** — all merges to master must use squash merge. No merge commits. No rebase merges. GitHub branch protection enforces this mechanically, but the reviewer must confirm the correct method is selected before clicking merge.

3. **Curator review gate** — DM the Curator with the PR number and a brief summary before merging. Curator review is strongly recommended. If Curator is unavailable, the Overseer may proceed after gates 1 and 2 are confirmed.

4. **Documentation audit gate** — mandatory before tagging any release; recommended for PRs that add or change user-facing behavior. Verify:
   - README version references match `package.json`
   - Docker image tags reference the correct version
   - Feature descriptions match actual code behavior
   - Configuration examples are tested and current
   - No stale references to deprecated APIs or auth models
   - Changelog entry exists for all breaking changes

## What to Check (block merge if any item fails)

- [ ] No secrets, credentials, or API keys in the diff
- [ ] No internal hostnames or IP addresses
- [ ] No session tokens or PINs
- [ ] No private/internal file paths that expose infrastructure layout
- [ ] Commit message is clean and does not reference internal system details
- [ ] Merge method is set to "Squash and merge"
- [ ] Curator notified (strongly recommended — if unavailable, proceed after gates 1 and 2)
- [ ] Documentation audit complete (mandatory for releases — README version, Docker tags, feature descriptions, config examples, no stale API refs, changelog updated)

## Enforcement

This policy is mandatory. Any merge that bypasses a gate — even in an emergency — must be flagged to the Curator immediately after the fact and documented in the task log.

# 620 — GitHub Actions Version Bumps

## Objective

Close 5 stale dependabot PRs and apply all GitHub Actions version bumps in a single commit on master.

## Dependabot PRs to close

- #8 `docker/metadata-action` 5.10.0 → 6.0.0
- #9 `docker/login-action` 3.7.0 → 4.0.0
- #10 `actions/checkout` 4.3.1 → 6.0.2
- #11 `sigstore/cosign-installer` 3.9.1 → 4.0.0
- #12 `actions/setup-node` 4.4.0 → 6.3.0

## Steps

1. On a fresh branch from master, update `.github/workflows/ci.yml` and `.github/workflows/publish.yml`:
   - `actions/checkout` — update SHA + comment to v6
   - `actions/setup-node` — update SHA + comment to v6
   - `sigstore/cosign-installer` — update SHA + comment to v4
   - `docker/login-action` — update SHA + comment to v4
   - `docker/metadata-action` — update SHA + comment to v6
2. Use the SHAs from the dependabot PR branches (they're verified):
   - `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd` # v6
   - `actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f` # v6
   - `sigstore/cosign-installer@faadad0cce49287aee09b3a48701e75088a2c6ad` # v4
   - `docker/login-action@b45d80f862d83dbcd57f89517bcf500b2ab88fb2` # v4
   - `docker/metadata-action@030e881283bb7a6894de51c315a6bfe6a94e05cf` # v6
3. Commit: `chore(actions): bump checkout v6, setup-node v6, cosign-installer v4, login-action v4, metadata-action v6`
4. Create PR to master, merge it
5. Close PRs #8, #9, #10, #11, #12 with a comment linking to the consolidated commit
6. Monitor CI on the merged commit

## Notes

- `docker/setup-buildx-action` and `docker/build-push-action` are NOT in the dependabot batch — leave them as-is
- `pnpm/action-setup` is also not in the batch — leave as-is

## Completion

- Branch `chore/actions-version-bumps` created from master, all 6 action SHA/version comments updated
- PR #45 created and merged (squash) as commit `3c88a15`
- Dependabot PRs #8, #9, #10, #11, #12 closed with reference comment to #45
- **CI** on master: ✅ passed
- **Publish Docker image** on master: ✅ passed

# Release branching process

How feature work flows from `dev` through a release branch to `master`.

## Branches

- `master` — shipped releases only. Each merge to master is a tagged release.
- `dev` — integration trunk. All feature work, fixes, and refactors land here first. Always must be in some-shape buildable state.
- `release/X.Y` — release candidate cuts. Branched from `dev` when dev is judged stable. One per minor version. Naming is `release/<major>.<minor>` (e.g. `release/7.2`). No patch suffix in the branch name — patches land via PR or hotfix from the same release branch.

## Cut a release branch

When dev is stable enough to call a release candidate:

1. Confirm dev is green (lint, tests, manual acceptance if applicable).
2. Branch off dev HEAD: `git checkout -b release/<major>.<minor>`.
3. Push with upstream: `git push -u origin release/<major>.<minor>`.
4. Bump `package.json` version on the release branch only: `<major>.<minor>.0`.
5. Open a PR from `release/<major>.<minor>` → `master`. This PR is the release candidate.

Dev keeps moving. Anything new on dev is for the next release, not this one.

## Release PR is locked

Once `release/X.Y` → `master` PR is open, treat the PR as locked:

- Only changes that go into release/X.Y are critical fixes, polish, or Copilot-review responses.
- No new feature merges to release/X.Y.
- The PR undergoes Copilot exhaustion: every Copilot review comment is resolved before merge. Curator routes Copilot comments to Overseer for triage.

## Hotfixes

Critical fix needed on a shipped release:

1. Branch from `release/X.Y` HEAD (or from the `vX.Y.Z` tag): `git checkout -b hotfix/X.Y.Z release/X.Y`.
2. Land the fix.
3. Bump patch version on the branch.
4. PR back to `release/X.Y`, then `release/X.Y` → `master`.
5. Cherry-pick or merge fix back to `dev` so the next release carries it.

## Merge policy

All merges (release → master, hotfix → release, PR → dev) squash. See `merge-policy.md`.

## Why this process

- Dev never blocks on a release. Feature work continues while a release is in review.
- Release branches are auditable. The exact commits in `vX.Y.Z` are the commits in `release/X.Y` at tag time.
- Copilot exhaustion has a clear scope: it runs against the release PR, not against every dev commit.

## Related

- `release-checklist.md` — per-release blocking criteria. Run against each release PR before merge.
- `merge-policy.md` — squash convention.

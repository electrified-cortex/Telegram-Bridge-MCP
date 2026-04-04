# Release Checklist

Reusable checklist template for all releases. Copy and fill in the version number when preparing a release.

## Blocking — Must Pass

- [ ] All automated tests pass (lint clean, build clean)
- [ ] Manual acceptance test — all phases of the relevant test script pass
- [ ] No open high-priority bugs
- [ ] Changelog finalized for this version
- [ ] All PRs for this release reviewed and approved
- [ ] Copilot code review passed — no critical findings

## Documentation Audit (Gate 4 — mandatory for releases)

- [ ] README version references match `package.json`
- [ ] Docker image tags reference the correct version
- [ ] Feature descriptions match actual code behavior
- [ ] Configuration examples are tested and current
- [ ] No stale references to deprecated APIs or auth models
- [ ] Changelog entry exists for all breaking changes

## Release Mechanics

- [ ] Version bumped in `package.json`
- [ ] Git tag created: `vX.Y.Z`
- [ ] Docker image published to `ghcr.io/electricessence/telegram-bridge-mcp:latest` and `:vX.Y.Z`
- [ ] GitHub release created with changelog notes

## Nice-to-Have — Won't Block

- [ ] Performance testing with 3+ sessions
- [ ] Stress test: rapid session join/leave cycles
- [ ] Rate limit tracking verified

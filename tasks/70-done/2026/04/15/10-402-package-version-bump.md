## ⚠️ Pre-Flight Rejection

**Criterion already satisfied in `3f527e9` (dev HEAD).**

`package.json` already shows `"version": "6.0.0"`. The version was bumped before this task was created. No work needed.

---


Source: PR #126 Copilot review (Round 2)
---

# package.json: align version with v6.0.0

## Objective

Bump `package.json` version to `6.0.0` to match the actual release version.

## Context

PR #126 Copilot comment:
- [r3048353449](https://github.com/electricessence/Telegram-Bridge-MCP/pull/126#discussion_r3048353449)

PR title/description indicate a release but package.json version doesn't match.
The version should be `6.0.0` per operator directive and the breaking changes
in this release (dequeue rename, tool removals, unified send).

## Acceptance Criteria

- [ ] `package.json` version is `6.0.0`
- [ ] Build passes

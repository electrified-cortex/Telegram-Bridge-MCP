# Task #021 — Documentation Audit & README Update

| Field    | Value                                            |
| -------- | ------------------------------------------------ |
| Priority | 40 (low — polish, no functional impact)          |
| Created  | 2026-03-19                                       |

## Goal

Review all documentation for accuracy, completeness, and consistency with the current v4 multi-session codebase. Update the README to reflect the current feature set.

## Strategy

**Branch from:** `master`
**Worktree:** `40-021-doc-audit`
**Branch name:** `task/021-doc-audit`
**Separate PR:** Yes — targets `master`

Documentation-only changes. No code changes expected.

## Scope

### 1. README.md

- Update feature list to reflect v4 multi-session architecture
- Update setup instructions if changed
- Add/update examples for new tools (animation, multi-session, governor)
- Verify all links work

### 2. docs/ folder audit

Review each file for accuracy:

- `behavior.md` — agent guide, verify all rules match current code
- `communication.md` — messaging patterns
- `customization.md` — verify customization options
- `design.md` — architecture, verify diagrams/descriptions match v4
- `formatting.md` — message formatting rules
- `security-model.md` — security documentation
- `setup.md` — installation/configuration
- `super-tools.md` — tool documentation
- `restart-protocol.md` — shutdown/restart procedure

### 3. Changelog review

- Verify `changelog/unreleased.md` is accurate and complete
- Check that prior changelog entries are well-formatted

## Completion

Worktree: `.worktrees/40-021-doc-audit`, branch: `task/021-doc-audit` (pushed to remote, targets `master`)

**Findings:**

- All docs reviewed: `behavior.md`, `security-model.md`, `setup.md`, `super-tools.md`, `restart-protocol.md`, `communication.md`, `formatting.md`, `customization.md`, `design.md`
- `changelog/unreleased.md` is accurate and well-formatted for the master branch

**Changes made:**

- `README.md`: Updated Docker image version tag from `4.1.0` → `4.2.0`
- `README.md`: Added `notify_shutdown_warning` to the Utilities tool list (tool exists in codebase but was absent from README)
- `docs/behavior.md`: Updated built-in commands section — replaced "four built-in commands (list)" with accurate description of four always-on commands plus `/governor` as a dynamic 5th command shown only when 2+ sessions are active
- `changelog/unreleased.md`: Added two bullets for the README and behavior.md doc changes

No broken links found. No stale feature references found. No code changes.

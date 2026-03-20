# Task #021 — Documentation Audit & README Update

| Field    | Value                                            |
| -------- | ------------------------------------------------ |
| Priority | 40 (low — polish, no functional impact)          |
| Status   | Draft                                            |
| Created  | 2026-03-19                                       |

## Goal

Review all documentation for accuracy, completeness, and consistency with the current v4 multi-session codebase. Update the README to reflect the current feature set.

## Strategy

**Branch from:** `v4-multi-session`
**Worktree:** `40-021-doc-audit`
**Branch name:** `task/021-doc-audit`
**Separate PR:** Yes — targets `v4-multi-session`

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

## Acceptance Criteria

- [ ] README reflects current v4 feature set
- [ ] All docs reviewed for accuracy
- [ ] No broken internal links
- [ ] No stale references to removed features
- [ ] Changelog entries complete and accurate

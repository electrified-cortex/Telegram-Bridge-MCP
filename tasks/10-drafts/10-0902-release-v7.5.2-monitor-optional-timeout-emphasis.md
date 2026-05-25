---
status: draft
type: release
target_version: v7.5.2
created: 2026-05-16
priority: medium
---

# Release v7.5.2 — Monitor optional-timeout emphasis

## Why

A worker (or sub-agent) reported that `monitor.ps1` requires `-Timeout` — this is **false**. The flag has been opt-in with default 0 (disabled) since v7.4.0 / file-watching skill inception. The misreport indicates the SKILL.md docs aren't emphatic enough about which flags are required vs optional. We need a documentation release that makes the optionality unmissable, and a fleet-wide propagation so consumers stop reporting the false constraint.

## Scope

This is a docs-only release. No code changes to `monitor.ps1`, `monitor.sh`, `watch.ps1`, or `watch.sh` are required (their defaults already do the right thing).

### Changes already applied (uncommitted in main branch):

1. `skills/file-watching/SKILL.md` — emphasize-optional rewrite of the parameter docs block:
   - Bold lead: "**Only `<file-path>` is required. Every flag below is optional.**"
   - Each flag tagged with `(optional)`
   - `-Timeout` flagged specifically: `(**optional — omit for indefinite runs**)`
2. Same edit propagated fleet-wide to 14 other SKILL.md copies under per-pod skills directories (curator, overseer, BT, foreman + worker variants under task-engine, skills, Telegram-Bridge-MCP, hosts/services.cortex.lan).

## Acceptance criteria

- [ ] Version bump in `package.json` to `7.5.2`
- [ ] `changelog/unreleased.md` v7.5.2 section documents the SKILL.md change with the rationale (false-required-flag misreport)
- [ ] `changelog/2026-05-16_v7.5.2.md` (or appropriate date) created
- [ ] `skills/file-watching/SKILL.md` reflects the emphasis (already done; verify on commit)
- [ ] `docs/` (if any) cross-refs to the skill picked up the new emphasis
- [ ] Release tagged and pushed
- [ ] Downstream consumers (the 14 fleet-wide copies) are kept in sync — note that propagation should be automatic for new installs but existing pods need the manual edit. A short "what to update" note in the changelog.

## Out of scope

- Changing default behavior of `-Timeout`. It stays opt-in with default 0.
- Validation logic change. The flag remains a positive-integer guard when explicitly passed.

## Delegation

Worker-eligible. Mechanical docs release; no design judgement required beyond what's specified.

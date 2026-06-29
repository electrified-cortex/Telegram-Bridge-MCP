---
title: "TMCP: Backfill v7.x git tags as Worker dogfood task"
id: 10-0892
priority: P10
status: draft
category: DevOps / Release
filed: 2026-05-10
source: TG (operator 2026-05-10)
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: N/A — tags only, no code change
agent_type: Worker
model_class: sonnet-class
reasoning_effort: low
---

## Refinement history

- Overseer bounce 2026-06-01: REJECT — no delegation, push-to-origin AC violates sandbox, optional/required ambiguous.
- Fixed 2026-06-28: delegation frontmatter added, push removed from required ACs (operator pushes), optional clearly separated.

# Backfill v7.x Git Tags

## Context

v7 releases (v7.0.0–v7.4) shipped via PR merge to master but no git tags were created at release time. Latest tag was v5.0.1 until v7.4.1 was manually tagged 2026-05-10. This task backfills the missing annotated tags.

Operator (2026-05-10): "Get our new worker to do it when everything is dialed in. We can use that as dogfood."

## Commits to tag

| Version | Commit | PR |
|---|---|---|
| v7.0.0 | f0a1f703 | #136 |
| v7.0.1 | 5701d007 | #151 |
| v7.1.0 | 8b012d8a | #155 |
| v7.2.0 | e8e019dc | #158 |
| v7.2.1 | fc952828 | #160 |
| v7.2.2 | 9866cfbd | #161 |
| v7.3 | 4747c989 | #164 |
| v7.4 | fd635289 | #167 |

v7.4.1 already tagged at ab1d4139 — skip.

## Required Acceptance Criteria

1. [ ] Annotated tags created locally for each commit in the table above (tag name = version string, e.g. `v7.0.0`)
2. [ ] Tag message summarizes the corresponding PR description or release commit body (one line each)
3. [ ] Worker reports the full `git tag -l "v7.*"` output to confirm all 8 tags present
4. [ ] No existing tags overwritten

## Out of scope (operator action)

- `git push origin --tags` — operator pushes after reviewing Worker output
- GitHub release pages — separate optional task if operator wants them

## Notes

- This is bounded, mechanical, and deterministic — ideal Worker dogfood
- All commits are on master; no branch gymnastics needed
- Worker must NOT push — create tags locally and report for operator review

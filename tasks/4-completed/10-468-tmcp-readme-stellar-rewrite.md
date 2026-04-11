---
Created: 2026-04-10
Status: Draft
Host: local
Priority: 10-468
Source: Operator directive
---

# TMCP README — Stellar Quality Rewrite

## Objective

Rewrite the Telegram-Bridge-MCP README.md to "stellar galactic level quality." It must be so polished that no visitor would question where docs are, what the project does, or how to get started. This is the public face of the project.

## Context

The README needs to showcase v6's four-tool API, explain the bridge concept clearly, highlight key features, and provide a smooth onboarding path. It should be refined, professional, and complete — not just functional.

## Requirements

- Clear project description and value proposition
- Feature highlights (multi-session, approval flow, profiles, animations, super tools, etc.)
- Quick start guide
- Architecture overview (brief)
- API overview showing the four-tool pattern (`send`, `action`, `dequeue`, `help`)
- Links to detailed docs for deeper dives
- Badges (build status, version, license)
- Professional formatting — no walls of text, good use of headers/tables/code blocks

## Git Workflow — CRITICAL

**Do NOT merge to dev locally.** This task produces its own branch and PR:

1. Create branch `docs/readme-rewrite` from current `dev`
2. Rewrite README.md on that branch
3. Push the branch to origin
4. Create a PR from `docs/readme-rewrite` → `dev`
5. Trigger Copilot review on the PR
6. Run Copilot exhaustion until all comments are resolved
7. Only then merge to dev

## Acceptance Criteria

- [x] README.md completely rewritten for v6
- [x] No references to v5 tools or old API
- [x] Quick start section tested and accurate
- [x] Feature list comprehensive and current
- [x] Professional formatting — scannable, not a wall of text
- [ ] Branch pushed as separate PR (not merged locally) — awaiting Overseer push
- [ ] Copilot review triggered and exhausted on the PR
- [ ] Curator review before final merge

## Completion

**Branch:** `docs/readme-rewrite` (commit `71caa52`)
**Worktree:** `Telegram MCP/.worktrees/10-468`
**Status:** Committed, pending Overseer push + PR creation

### What changed
- README.md fully rewritten for v6 (238 insertions, 110 deletions)
- 4-tool API prominently documented: `send`, `action`, `dequeue`, `help`
- Fixed `"type": "streamable-http"` (was `"type": "http"`) in config example
- `dm` established as canonical DM type; `direct` noted as alias only
- Super tools create→update pattern cross-referenced inline
- Token format and dequeue origin explained
- Documentation table collecting all doc links added
- No v5 tool references remain

### Code Review Findings (resolved)
- **Critical:** Wrong transport type in config (`http` → `streamable-http`)
- **Critical/Major:** `direct` → `dm` as canonical type in send table and multi-session section
- **Major:** Added token origin note to dequeue section, token params to examples, web-access qualifier on "paste to AI" tip, `target` alias documented
- **Minor:** Moved git-index-safety link to docs table; added checklist/progress cross-reference

### Deferred
- "No Claw? No Problem" tagline references internal ZeroClaw — noted by reviewer as insider jargon for external visitors. Left unchanged per original task spec (tagline was present in prior README). Can be addressed separately.
- `dm` table cell phrasing slightly dense (Info-level) — acceptable as-is.

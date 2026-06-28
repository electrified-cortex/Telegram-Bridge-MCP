---
created: 2026-06-27
status: draft
priority: 20
source: Operator TG 80330, 2026-06-27
repo: electrified-cortex/Telegram-Bridge-MCP
type: TechDebt
severity: medium
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
---

# TMCP — README + AGENTS.md Doc Overhaul

**ID**: 10-3061
**Date**: 2026-06-27
**Priority**: Medium
**Origin**: Operator TG 80330

## Operator verbatim (TG 80330)

> "Hmmm.... This requires a background agent audit. What belongs in the readme? I'd prefer AGENTS.md instead of CLAUDE.md. We should have a task to overhaul the README.md. It is still a standard, very important, that a user can paste the TMCP repo link and say 'set me up' and an agent make it happen seamlessly."

## Problem

Three doc files exist with unclear/overlapping responsibilities:

| File | Current content | Size |
|---|---|---|
| `README.md` | Unknown — needs audit | ? |
| `AGENTS.md` | Public user onboarding guide: setup, MCP client config snippets, verification, "Starting the Loop" | 237 lines |
| `CLAUDE.md` | "Use pnpm for all package operations" | 2 lines |

The operator standard: **a user can paste the TMCP repo link and say "set me up" to any AI agent, and the agent makes it happen seamlessly.** `AGENTS.md` must satisfy this standard alone.

## Required work

### Phase 1 — Audit (background agent)

Audit all three files and determine canonical home for each content type:

1. What is in `README.md` now? What should stay vs. move?
2. Is `AGENTS.md` complete for the "set me up" standard? What's missing?
3. `CLAUDE.md` has one useful line ("use pnpm"). Where does it belong?
4. Are there doc gaps — things not documented anywhere that should be?

### Phase 2 — Restructure

After audit:

1. **README.md** → human-facing: what it is, why use it, quickstart for humans, link to detailed docs. NOT a giant config dump.
2. **AGENTS.md** → agent-facing: the "set me up" document. Decision tree + all config snippets + verification steps. Must be self-contained — agent reads it and completes setup without leaving the file.
3. **CLAUDE.md** → absorb "use pnpm" line into AGENTS.md (dev section). Then `git mv CLAUDE.md` → delete (operator preference: AGENTS.md, not CLAUDE.md).
4. Ensure `AGENTS.md` is listed as the primary agent instruction file (not CLAUDE.md) in any dev tooling config.

## "Set me up" standard

The test: user sends an AI agent the TMCP repo URL and says "set me up." The agent:
1. Reads `AGENTS.md`
2. Follows the decision tree to discover current state (creds? which client?)
3. Guides the user through any missing steps
4. Connects and verifies

`AGENTS.md` must make this possible without any other file.

## Acceptance Criteria

- [ ] Background agent audit completes: report of what belongs where, gaps identified
- [ ] `README.md` restructured for human audience (quickstart + overview, no giant config walls)
- [ ] `AGENTS.md` satisfies the "set me up" standard end-to-end, self-contained
- [ ] `CLAUDE.md` content merged into `AGENTS.md` dev section; `CLAUDE.md` removed via `git rm`
- [ ] No content orphaned — everything currently in docs has a clear canonical home
- [ ] `tsc --noEmit` passes (docs-only change, but verify)
- [ ] All pre-existing tests pass

## Delegation

**Phase 1**: Background sonnet audit agent — reads all three files, reports findings, proposes structure.
**Phase 2**: Worker implements the restructure per Phase 1 findings.
Executor: Worker / Reviewer: Curator
Needs Overseer gate before implementation.

## Notes

- No `.github/instructions` folder exists; not creating one unless operator directs
- `AGENTS.md` currently has a "Starting the Loop" section referencing `LOOP-PROMPT.md` — verify that file exists and is still accurate

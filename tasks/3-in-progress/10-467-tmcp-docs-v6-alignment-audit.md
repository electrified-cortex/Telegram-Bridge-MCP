---
Created: 2026-04-10
Status: Draft
Host: local
Priority: 10-467
Source: Operator directive
---

# TMCP Documentation Audit — v6 API Alignment

## Objective

Audit all documentation files in the Telegram-Bridge-MCP repo to ensure they accurately reflect the v6 three-tool API (`send`, `action`, `dequeue` + `help`). No reader should find outdated references to removed v5 tools or incorrect parameter names.

## Context

v6 consolidated ~40+ tools into 3 dispatchers. Docs may still reference old tool names (`send_text`, `set_reaction`, `get_me`, `send_direct_message`, etc.), old parameter names (`voice` instead of `audio`), or old workflows. The changelog and setup guide have had partial fixes but a comprehensive pass is needed.

## Scope

Files to audit:

- `docs/` — all documentation files
- `LOOP-PROMPT.md` — agent loop reference
- `.github/instructions/` — Copilot instruction files
- `changelog/unreleased.md` — accuracy of feature descriptions
- Task docs in `tasks/1-drafts/` — stale references

**Excludes:** README.md (separate task), test files, source code.

## Git Workflow — CRITICAL

**Do NOT merge to dev locally.** This task produces its own branch and PR:

1. Create branch `docs/v6-alignment` from current `dev`
2. Make all documentation fixes on that branch
3. Push the branch to origin
4. Create a PR from `docs/v6-alignment` → `dev`
5. Trigger Copilot review on the PR
6. Run Copilot exhaustion until all comments are resolved
7. Only then merge to dev

## Acceptance Criteria

- [ ] All doc files checked for v5 tool name references — none remain
- [ ] Parameter names correct everywhere (`audio` not `voice` for TTS, etc.)
- [ ] `changelog/unreleased.md` accurately describes v6 features
- [ ] `LOOP-PROMPT.md` references updated to v6 API
- [ ] `.github/instructions/` files aligned with v6
- [ ] Branch pushed as separate PR (not merged locally)
- [ ] Copilot review triggered and exhausted on the PR
- [ ] No behavioral/code changes — documentation only

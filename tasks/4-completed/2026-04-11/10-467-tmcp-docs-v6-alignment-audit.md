---
Created: 2026-04-10
Status: Draft
Host: local
Priority: 10-467
Source: Operator directive
---

# TMCP Documentation Audit — v6 API Alignment

## Objective

Audit all documentation files in the Telegram-Bridge-MCP repo to ensure they accurately reflect the v6 four-tool API (`send`, `action`, `dequeue`, and `help`). No reader should find outdated references to removed v5 tools or incorrect parameter names.

## Context

v6 consolidated ~40+ tools into 4 dispatchers. Docs may still reference old tool names (`send_text`, `set_reaction`, `get_me`, `send_direct_message`, etc.), old parameter names (`voice` instead of `audio`), or old workflows. The changelog and setup guide have had partial fixes but a comprehensive pass is needed.

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

## Completion

**Completed by:** Worker 1 (SID 4)
**Branch:** `docs/v6-alignment`
**Commit:** `4ca2a0e` (Telegram MCP repo)
**Worktree:** `Telegram MCP/.worktrees/docs-v6-alignment`

### What changed

18 documentation files audited and updated. LOOP-PROMPT.md and changelog/unreleased.md were already clean. Historical/archived docs intentionally left unchanged (migration guide, v4 checklist, coverage snapshots, etc.).

**Files changed:**
- `.github/instructions/telegram-communication.instructions.md`
- `docs/agent-setup.md`, `docs/behavior.md`, `docs/communication.md`, `docs/customization.md`
- `docs/formatting.md`, `docs/group-chat-roadmap.md`, `docs/inter-agent-communication.md`
- `docs/manual-test-walkthrough.md`, `docs/multi-session-flow.md`, `docs/multi-session-prompts.md`
- `docs/multi-session-protocol.md`, `docs/multi-session-test-script.md`, `docs/restart-protocol.md`
- `docs/security-model.md`, `docs/session-profiles.md`, `docs/super-tools.md`, `docs/test-session-prompt.md`

### Code review

- Pass 1: Found 6 missed v5 references (`update_checklist` ×2, `update_progress` ×2, `send_text` ×2) — fixed
- Pass 2: Zero v5 references remaining across all 18 files — approved

### Push / PR

Hook blocked Worker push. Overseer to push `docs/v6-alignment` to origin and create PR → `dev`. Copilot review and exhaustion pending Overseer action.

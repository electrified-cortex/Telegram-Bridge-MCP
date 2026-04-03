# Task: Sync Governance Patterns from cortex.lan

| Field    | Value                          |
| -------- | ------------------------------ |
| Created  | 2026-03-26                     |
| Priority | 20-070                         |
| Scope    | Telegram-Bridge-MCP            |
| Stage    | 3-in-progress                  |
| Assigned | Worker 3 (SID 6)               |
| Assigned-date | 2026-04-03                |

## Goal

Port valuable governance patterns from `cortex.lan` workspace to this repo's agent/instruction files. The cortex.lan workspace has a mature governance framework that this repo currently lacks.

## Gaps Identified

### High Priority

1. **Governance Framework** — cortex.lan has 10 "Absolute Rules" in `copilot-instructions.md`; this repo's version is minimal. Key rules to adapt:
   - Friction Protocol (one retry max, never brute-force, report up)
   - Ask Questions — Don't Assume
   - Document Everything
   - No One-Off Complex Commands (write temp scripts)
   - Keep Workspace in High Order

2. **Adversarial Reviewer Agent** — cortex.lan has a dedicated skeptic agent that source-verifies claims and outputs structured RISKS/FLAWS/RECOMMENDATIONS. This repo has no equivalent.

### Medium Priority

3. **Task Drafts Sub-structure** — add `1-drafts/ready-for-queuing/` and `1-drafts/epics/` folders
4. **Friction Protocol in Worker Rules** — inject into existing `worker-rules.instructions.md`
5. **Overseer Identity Refinement** — port "librarian not taskmaster," "voice of reason," "less is more" from Curator

### Lower Priority

6. **Enhanced severity model** in code reviewer (Critical/Major/Minor/Info)

## Source Files (cortex.lan)

- `d:\Users\essence\Development\cortex.lan\cortex.lan\.github\copilot-instructions.md`
- `d:\Users\essence\Development\cortex.lan\cortex.lan\.github\agents\adversarial-reviewer.agent.md`
- `d:\Users\essence\Development\cortex.lan\cortex.lan\.github\agents\curator.agent.md` (identity sections)

## Acceptance Criteria

- [x] `copilot-instructions.md` updated with adapted governance rules (infrastructure-specific refs removed)
- [x] `adversarial-reviewer.agent.md` created and registered in AGENTS.md
- [x] Worker rules updated with explicit friction protocol
- [x] Overseer identity refined with curator-style principles
- [x] All changes pass markdown lint

## Completion

**Completed by:** Worker 3 (SID 6)
**Date:** 2026-04-03
**Branch:** `20-070`
**Commits:** `9bca395` (main implementation), `a8eeed3` (post-review fix)

### What was done

- `.github/copilot-instructions.md` — added Governance Rules section: Friction Protocol, Ask Don't Assume, Document Everything, No One-Off Complex Commands, Keep Workspace in High Order (adapted from cortex.lan, infrastructure-specific refs removed). Fixed missing trailing newline.
- `.github/agents/adversarial-reviewer.agent.md` — created new file with source-verification focus, RISKS/FLAWS/RECOMMENDATIONS/VERDICT output format, test coverage as hard requirement.
- `.github/AGENTS.md` — created new file registering all agents (Overseer, Worker, Task Runner, Code Reviewer, Adversarial Reviewer, task subagents) with usage guidance.
- `.github/agents/overseer.agent.md` — refined Identity section: "librarian not taskmaster", "voice of reason", "less is more", "serve the operator", "source-verify everything".
- `.github/instructions/worker-rules.instructions.md` — added Friction Protocol section with escalation format and permission denial handling.

### Review notes

- Doc/config-only changes — code review loop skipped per policy.
- Post-review fix: removed `execute` from adversarial-reviewer tools list (read-only agent per workspace policy).
- Minor: items 3 (Task Drafts Sub-structure) and 6 (Enhanced severity model in code reviewer) were out of scope for this task and not implemented.

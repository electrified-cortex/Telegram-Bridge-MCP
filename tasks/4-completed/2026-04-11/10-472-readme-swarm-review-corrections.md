---
Created: 2026-04-11
Status: Completed
Host: local
Priority: 10-472
Source: Operator swarm review of PR #130
---

# README Swarm Review Corrections

## Objective

Fix 5 issues identified by operator's multi-agent swarm review of PR #130 (docs/readme-rewrite → dev).

## Context

Operator ran an independent multi-agent review of the README rewrite (task 10-468) and surfaced 5 findings. Findings were relayed via DM to Overseer → Worker 2 implemented fixes.

**Note:** This task was created retroactively. Findings were relayed directly to Overseer without formal task creation — this task provides the paper trail.

## Acceptance Criteria

- [x] Auth model wording corrected — token required for session-scoped calls only, not ALL calls
- [x] Checklist example uses proper `{label, status}` step objects, not string arrays
- [x] MCP config examples show correct VS Code `.vscode/mcp.json` format with `"servers"` key
- [x] MD036 pseudo-heading violations addressed (remaining bold lines are config labels inside `<details>`, acceptable)
- [x] Task 10-468 doc updated from "three-tool" to "four-tool" API

## Completion

**Date:** 2026-04-11
**Commit:** 1427071 (Worker 2, branch docs/readme-rewrite)
**Summary:** All 5 swarm review findings fixed and verified. Auth wording, checklist schema, VS Code config format, heading lint, and task doc consistency all corrected.
**Verification:** Curator verified all 5 fixes against worktree after push.
**Process note:** Bypassed formal task pipeline (DM relay to Overseer). Retroactive task doc created per operator directive — DM shortcuts require either self-owned verification or a task trail.

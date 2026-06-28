---
title: "TMCP: Deny button in session/tool approval UI is unresponsive"
id: 10-3070
priority: HIGH
category: Bug
status: queued
reported: 2026-06-28
source: Operator TG 80704 (voice)
agent_type: Worker
model_class: sonnet-class
branch_target: dev
---

# Bug: Deny Button Unresponsive in Approval UI

## Operator Report

> "I'm clicking deny and it's not doing anything. So that's a bug."
> — TG 80704 (voice), 2026-06-28

## Context

Operator was seeing repeated approval prompts (likely for `dequeue` calls triggered by duplicate monitors running simultaneously). When clicking "deny" in the approval UI, the button had no visible effect — the prompt remained, no denial occurred.

## Observed Behavior

- Approval prompt appears (for session or tool call)
- Operator clicks "Deny" button
- Nothing happens — UI does not dismiss, tool call is not denied, no feedback given

## Expected Behavior

Clicking "Deny" should:
1. Immediately cancel / reject the pending tool call or session action
2. Dismiss the approval prompt
3. Optionally: surface a brief confirmation that the action was denied

## Investigation Needed

- [ ] Is this in the Claude Code MCP tool-permission dialog (CC-level), or a TMCP governor approval surface?
- [ ] Reproduce: trigger a governor-gated tool call, click deny — does it block or silently pass?
- [ ] Check if deny path has any event handler / action wired up
- [ ] Check if there's a race condition where the tool call completes before deny fires

## Scope

- Claude Code MCP approval dialog AND/OR TMCP governor approval UI — determine which surface owns this
- If CC-level: may need upstream report to Anthropic; capture repro steps

## Acceptance Criteria

1. Clicking "Deny" reliably cancels the pending action
2. Prompt dismisses after denial
3. No ghost approvals — denied calls must not execute

## Gate review

- date: 2026-06-28
- verdict: PASS
- review type: inline (bug/investigation — ACs binary once surface identified)
- checked: 3 ACs binary (deny works, prompt dismisses, no ghost approvals); scope explicit (identify CC-level vs TMCP surface, then fix); worker-resolvable investigation; HIGH priority confirmed
- note: add agent_type: Worker, model_class: sonnet-class, branch_target: dev to frontmatter before foreman picks up. Investigation first — if CC-level, capture repro + file upstream report; if TMCP, fix in governor deny handler.
<!-- overseer-gate: PASS 2026-06-28 -->

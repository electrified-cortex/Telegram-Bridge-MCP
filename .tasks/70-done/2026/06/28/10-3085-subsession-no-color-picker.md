---
id: 10-3085
title: "TMCP: Color picker fires on sub-session spawn; child should inherit parent color"
priority: P2
status: draft
category: Bug/UX
filed: 2026-06-28
source: TG 61404
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: worker/tmcp-p4-subsession-inherit-color
agent_type: Worker
model_class: sonnet-class
reasoning_effort: low
parent-idea: 50-0093
---

# 10-3085: Sub-Session Should Inherit Parent Color, Not Prompt for New One

## Problem

When `session/spawn-child` spawns a child session, the bridge surfaces a color-selection
prompt (and optionally an approval ticket) to the operator. For the parent-with-topic model,
no color selection is needed — the child should silently inherit the parent session's color.

Operator framing (TG 61404): "It shouldn't have to select a color."

## Expected behavior

- `session/spawn-child` does NOT surface a color picker or approval ticket to the operator
- Child session inherits the parent's existing color automatically
- No operator interaction required to complete child session spawn

## Acceptance Criteria

- [ ] `session/spawn-child` completes without surfacing a color-selection prompt to the
      operator chat
- [ ] Child session's color in the session list matches the parent session's color
- [ ] If the parent has no color set (edge case), child gets a default; no prompt
- [ ] Existing top-level `session/start` color-selection behavior is unchanged
- [ ] `npm run build` passes; existing tests pass

## Worker notes

- Find where the color picker / approval ticket is emitted during session creation;
  it may be in `src/session/start.ts` or the color-assignment module
- The condition to suppress should be: `parent_sid !== undefined` (i.e. this is a
  child session, not a root session)
- Color inheritance: read the parent session's color from session state and copy it
  to the child without any UI prompt

## Worktree

Branch: `worker/tmcp-p4-subsession-inherit-color`
Directory: `.git/.wt/tmcp-p4-subsession-inherit-color`
Base: `dev` at current HEAD

## Gate review

- reviewer: gate
- date: 2026-06-28
- verdict: PASS
- review type: adversarial gate
- checked: ACs 1-5 binary+testable; edge case (no parent color) in AC3; top-level session unaffected in AC4; condition clear (parent_sid !== undefined); delegation correct (Worker, sonnet-class, LOW — appropriate for targeted suppression fix)
- fixed: base branch main→dev
<!-- overseer-gate: PASS 2026-06-28 -->
## Verification

- **verdict**: APPROVED
- **verifier**: Overseer (push-gate)
- **date**: 2026-06-28
- **worker_commit**: 71ae16dd (+ foreman fix 71dc0c05)
- **squash_commit**: 74b8c6aa
- **tests**: 4189/4189 (171 test files — branch HEAD 71dc0c05)
- **LLM pre-pass**: gateway timed out — independent adversarial review substituted; PASS

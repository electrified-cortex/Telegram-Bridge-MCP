---
id: 10-3086
title: "TMCP: spawn_child_subagent_hint should recommend profile/dequeue-default, not per-call timing"
priority: P2
status: draft
category: Bug/DX
filed: 2026-06-28
source: TG 61404
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: worker/tmcp-p4-spawn-hint-dequeue
agent_type: Worker
model_class: sonnet-class
reasoning_effort: low
parent-idea: 50-0093
---

# 10-3086: spawn_child_subagent_hint Should Recommend profile/dequeue-default

## Problem

The `spawn_child_subagent_hint` service message currently instructs the spawned sub-agent
to "call `dequeue(token: <child>)` continuously" without guidance on `max_wait`. The
sub-agent inherits whatever default applies, which may be too short for human-paced
conversations. A sub-agent that is present to receive operator messages should use a long
blocking wait (~1800s) to stay available without burning turns.

Additionally, passing `max_wait` directly on individual `dequeue()` calls is a footgun
— `max_wait` per-call values are restricted and require `force: true`. The correct
pattern is to set a long session default via `profile/dequeue-default` once at startup,
then call bare `dequeue(token)` in the loop.

## Expected behavior

The `spawn_child_subagent_hint` service message instructs the spawned sub-agent to:
1. Call `action(type: "profile/dequeue-default", timeout: 1800)` early in its lifecycle
   to set a long blocking wait as the session default
2. Then call bare `dequeue(token: <child_token>)` in its loop (no per-call `max_wait`)

This guidance replaces any instruction to pass `max_wait` directly to `dequeue()`.

## Acceptance Criteria

- [ ] The `spawn_child_subagent_hint` service message contains guidance to call
      `profile/dequeue-default timeout: 1800` (or equivalent) before entering the
      dequeue loop
- [ ] The hint does NOT instruct the sub-agent to pass `max_wait` on individual
      `dequeue()` calls
- [ ] The hint's bare `dequeue(token)` loop instruction remains present
- [ ] No change to the `spawn_child_subagent_hint` format for non-timing guidance
- [ ] `npm run build` passes

## Worker notes

- Find the `spawn_child_subagent_hint` string in the codebase
  (`src/session/spawn-child.ts` or the hint generation module)
- Replace or augment the dequeue guidance section:
  - Add: "Call `action(type: 'profile/dequeue-default', timeout: 1800)` to set a
    long wait as default before entering your dequeue loop."
  - Remove any `max_wait` parameter suggestion from the `dequeue()` call example

## Worktree

Branch: `worker/tmcp-p4-spawn-hint-dequeue`
Directory: `.git/.wt/tmcp-p4-spawn-hint-dequeue`
Base: `dev` at current HEAD

## Gate review

- reviewer: gate
- date: 2026-06-28
- verdict: PASS
- review type: adversarial gate
- checked: ACs 1-5 binary+testable; positive (contains guidance) + negative (no max_wait suggestion) ACs both present; scope is a doc-string change only; delegation correct (Worker, sonnet-class, LOW — string edit, no logic change)
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

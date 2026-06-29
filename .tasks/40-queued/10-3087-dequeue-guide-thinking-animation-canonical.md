---
id: 10-3087
title: "TMCP: Dequeue guide must canonically document thinking animation scope"
priority: P2
status: draft
category: Bug/DX
filed: 2026-06-28
source: TG 81370
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: worker/tmcp-p4-dequeue-anim-canonical
agent_type: Worker
model_class: sonnet-class
reasoning_effort: low
---

# 10-3087: Dequeue Guide — Thinking Animation Canonical Behavior

## Problem

The current dequeue guide (`help('dequeue')` or `help('guide')`) does not explicitly
state when agents should fire the thinking animation. Agents default to firing it only
for operator messages, missing the case where an agent DM or other dequeued event
triggers real processing.

Operator directive (TG 81370): "I want the canonical behavior established now."

## Expected behavior

The dequeue/guide documentation explicitly states the canonical rule:

> Fire the thinking animation whenever **meaningful work is dequeued** — operator
> messages, agent DMs, reminders that trigger real processing, or any event that causes
> the agent to produce output or make decisions. Do NOT restrict it to operator-only
> triggers.

## Acceptance Criteria

- [ ] The `help('dequeue')` guide text (or equivalent dequeue behavior doc) explicitly
      states the canonical rule: thinking animation fires for any meaningful dequeued
      work, not operator messages only
- [ ] The guide text lists the qualifying triggers: operator message, agent DM, and
      reminders that produce work
- [ ] The `spawn_child_subagent_hint` (or its equivalent instruction to sub-agents)
      includes equivalent guidance if it currently implies operator-only scope
- [ ] No change to when `timed_out: true` triggers close of the dequeue loop —
      only the animation-fire rule is updated
- [ ] `npm run build` passes; existing tests pass

## Worker notes

- Find the dequeue guide text: search for `help('dequeue')` registration or the
  string "thinking animation" / "working animation" in `src/`
- Also check `spawn_child_subagent_hint` in `src/session/spawn-child.ts` — if it
  says "fire animation on operator message," broaden the language
- This is a documentation/string change only — no logic changes expected

## Worktree

Branch: `worker/tmcp-p4-dequeue-anim-canonical`
Directory: `.git/.wt/tmcp-p4-dequeue-anim-canonical`
Base: `dev` at current HEAD

## Gate review

- reviewer: gate
- date: 2026-06-28
- verdict: PASS
- review type: adversarial gate
- checked: ACs 1-5 binary+testable; scope strictly doc-string (dequeue guide + spawn hint); no logic change; qualifying triggers listed explicitly; delegation correct (Worker, sonnet-class, LOW)
<!-- overseer-gate: PASS 2026-06-28 -->

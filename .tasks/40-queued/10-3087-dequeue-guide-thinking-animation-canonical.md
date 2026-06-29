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

The dequeue/guide documentation explicitly states the full canonical state machine
for the thinking animation (same-agent scope — layering rules only apply across
different agents):

1. **Start thinking**: fire immediately when meaningful work is dequeued — operator
   message, agent DM, or work-triggering reminder. Not operator-only.
2. **Cancel thinking**: as soon as the SAME agent sends a text message OR sends a
   voice/audio recording, the thinking animation is canceled. Thinking is a precursor
   state, not a persistent one.

The bridge must enforce rule 2 automatically: any `send()` call from the same SID
must cancel an active thinking animation before proceeding.

## Acceptance Criteria

- [ ] The `help('dequeue')` guide text (or equivalent dequeue behavior doc) explicitly
      states the canonical rule: thinking animation fires for any meaningful dequeued
      work, not operator messages only
- [ ] The guide text lists the qualifying triggers: operator message, agent DM, and
      reminders that produce work
- [ ] The guide documents the cancel rule: thinking animation is canceled automatically
      when the same agent sends text or audio (typing/recording supersedes thinking)
- [ ] **Verified in bridge code**: a `send(type:'text')` or `send(type:'audio')` from
      the same SID cancels any active thinking animation for that SID before sending.
      If not implemented, add the cancel call in the send path.
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
- For the cancel-on-send verification: check whether `send.ts` (or the Telegram send
  path) already cancels active animations for the session before sending. If yes,
  document that it's in place. If no, add `clearAnimation(sid)` (or equivalent) at
  the top of the text/audio send path.
- Layering note: cancel only applies to the SAME SID. Different agents (different SIDs)
  can have concurrent animations at different priority levels — this task does not
  change that behavior.

## Worktree

Branch: `worker/tmcp-p4-dequeue-anim-canonical`
Directory: `.git/.wt/tmcp-p4-dequeue-anim-canonical`
Base: `dev` at current HEAD

## Gate review

- reviewer: gate
- date: 2026-06-28
- verdict: PASS
- review type: adversarial gate
- checked: ACs 1-7 binary+testable; scope expanded by operator directive (TG 81383) to include bridge-code verification that same-agent send cancels thinking animation; new AC4 bounded (verify + fix if absent); layering scope explicitly excluded; delegation updated LOW→medium (code path inspection required); worker notes precise on cancel-path location
<!-- overseer-gate: PASS 2026-06-28 -->

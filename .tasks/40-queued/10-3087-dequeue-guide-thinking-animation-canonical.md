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

The dequeue/guide documentation explicitly states the full canonical priority model
for same-SID animation states:

**Priority hierarchy (same SID):**
- **Recording** / **Typing** = strong indicators (highest priority)
- **Thinking** = weak indicator (lowest priority)

Rules:
1. **Start thinking**: fire when a real message is dequeued AND nothing else is in
   flight for that SID (no typing, no recording, no higher-priority animation).
2. **Thinking is a no-op if stronger state is active**: if the agent is already typing
   or recording, thinking must NOT fire or override.
3. **Cancel thinking**: as soon as the SAME SID starts typing (sends text) or
   recording (sends audio), thinking is immediately canceled. Thinking never overrides
   or persists alongside typing/recording.

Different SIDs have independent animation states — layering and priority rules are
per-SID only. This task does not change cross-SID behavior.

The bridge must enforce rules 2 and 3 automatically in the send path.

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

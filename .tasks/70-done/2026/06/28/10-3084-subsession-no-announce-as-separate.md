---
id: 10-3084
title: "TMCP: Sub-session emits session_joined announcement; should be silent topic switch"
priority: P2
status: draft
category: Bug/UX
filed: 2026-06-28
source: TG 61404
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: worker/tmcp-p4-subsession-silent-join
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
parent-idea: 50-0093
---

# 10-3084: Sub-Session Should Not Announce Itself as Separate Session

## Problem

When `session/spawn-child` creates a sub-session, the bridge emits a `session_joined`
service message that announces the child as a new identity with its own name and SID.
For the single-sub-session-at-a-time pattern, this announcement creates the wrong mental
model — the operator is talking to the parent coordinator on a topic, not to a new
identity joining a group chat.

Operator framing (TG 61404): "Sub-session should not announce itself as a separate session.
It should just show the topic."

## Expected behavior

- `session/spawn-child` does NOT emit a `session_joined` service message visible to the
  operator in the main chat
- A minimal topic-switch indicator is acceptable (e.g. "📌 Topic: <topic-name>") but
  no SID announcement, no separate identity declaration
- The child session remains invisible as an identity; only the topic context changes

## Acceptance Criteria

- [ ] `session/spawn-child` does not emit a `session_joined` service message to the
      operator's main chat (or emits only a silent/suppressed variant)
- [ ] The operator sees no SID announcement or new-identity declaration when a child
      session is spawned
- [ ] A topic-context line (if present) does not reference the child SID or present
      the child as a separate agent
- [ ] Existing behavior for actual new top-level sessions (non-child) is unchanged —
      `session_joined` still fires for root sessions
- [ ] `npm run build` passes; existing tests pass

## Worker notes

- Find where `session_joined` events are emitted in the spawn-child path
  (`src/session/spawn-child.ts` or similar)
- Distinguish between root session joins (should announce) and child session joins
  (should suppress or replace with topic-switch signal)
- Check whether suppression is configurable via a flag on `session/spawn-child` args
  or should always be silent for child sessions

## Worktree

Branch: `worker/tmcp-p4-subsession-silent-join`
Directory: `.git/.wt/tmcp-p4-subsession-silent-join`
Base: `dev` at current HEAD

## Gate review

- reviewer: gate
- date: 2026-06-28
- verdict: PASS
- review type: adversarial gate
- checked: ACs 1-5 binary+testable; root-session backward compat explicitly called out in AC4; scope bounded to spawn-child announce path; suppression condition clear (child vs root); delegation correct (Worker, sonnet-class, medium)
- fixed: base branch main→dev
<!-- overseer-gate: PASS 2026-06-28 -->
## Verification

- **verdict**: APPROVED
- **verifier**: Overseer (push-gate)
- **date**: 2026-06-28
- **worker_commit**: 71ae16dd (+ foreman fix 71dc0c05)
- **squash_commit**: TBD
- **tests**: 4189/4189 (171 test files — branch HEAD 71dc0c05)
- **LLM pre-pass**: gateway timed out — independent adversarial review substituted; PASS

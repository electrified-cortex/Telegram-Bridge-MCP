---
id: "10-0884"
title: "AUDIT: Agent-facing language conciseness pass — service messages, hints, help topics"
type: task
priority: 30
status: draft
created: 2026-05-06
filed-by: Worker
delegation: Worker
target_repo: telegram-bridge-mcp
target_branch: feat/10-0884-language-conciseness-audit
---

# Agent-Language Conciseness Audit (7.4 Final Pass)

## Background

Everything in TMCP that an agent reads — service messages, behavior nudges, onboarding
events, help topics — should be maximally concise. Agents only need to know what they
need right now; anything deeper belongs in a help topic. Help topics themselves should
read cleanly with no filler.

A GPT 5.4 audit subagent will produce a structured report identifying where language
can be tightened, then a follow-up implementation pass applies the changes.

## Scope

All agent-facing text in the TMCP source:

- **Service messages / onboarding events** — `src/service-messages.ts` and any
  `event_type` strings injected by the bridge (e.g., `behavior_nudge_*`,
  `onboarding_*`, `session_orientation`, `guidance_*`)
- **Behavior nudges** — nudge text delivered via the guidance system
- **Help topics** — all `help(topic: X)` responses (`src/tools/help.ts` or equivalent)
- **Hints** — inline `hint:` fields returned by any tool response
- **Error messages** — user-facing error text in tool responses

## Exclusions

- `onboarding_loop_pattern` — recently edited, do not touch
- Internal debug/dlog strings — not agent-facing
- Test files

## Audit Criteria (for GPT 5.4 subagent)

For each piece of text, evaluate:

1. **Conciseness** — can it be shorter without losing meaning?
2. **Filler** — words like "please", "Note that", "be sure to", "you should", "make sure"
3. **Redundancy** — does it repeat something in another message or the help file?
4. **Pointer pattern** — does it tell the agent what to do right now AND where to get
   more? (ideal: one-sentence action + `help(topic: X)` for depth)
5. **Clarity** — would a confused agent understand exactly what to do next?

## Deliverable

A structured audit report (`audit/language-conciseness.md`) containing:

- Table of findings: location | current text | issue | suggested rewrite
- Summary of patterns found
- Prioritized list of changes (high/medium/low impact)

Implementation of changes is a separate follow-up task.

## Acceptance Criteria

- [ ] GPT 5.4 subagent dispatched and report produced
- [ ] Report covers all in-scope files
- [ ] Loop-pattern message untouched
- [ ] Report committed to `audit/` on the task branch
- [ ] Curator reviewed report before implementation begins

## Branch

`feat/10-0884-language-conciseness-audit`

## Rollback

No code changes in this task — audit only. Nothing to roll back.

## Closure

**Closed:** 2026-05-07
**Status:** Superseded — findings applied in 10-0885 (squash-merged to master as PR #168, TMCP v7.4.1). Formal audit report not produced; implementation proceeded ahead of gate.

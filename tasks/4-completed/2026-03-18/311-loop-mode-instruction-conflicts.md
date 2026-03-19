# Loop mode instruction conflicts and tooling ergonomics

**Type:** Process / prompt refinement
**Priority:** 311 (Normal)
**Status:** Draft

## Goal

Capture the broader issues discovered while operating in Telegram loop mode that go beyond the core `dequeue_update` recipe covered by `310-telegram-loop-prompt-clarity.md`.

This document focuses on:

1. conflicting guidance across prompts, docs, and memory
2. stale memory hazards during session recovery
3. live-status tool selection (`show_animation` vs progress/checklist tools)
4. failure-mode warnings that should be made explicit for GPT-style agents

## Problem

The environment works, but several sources of guidance can pull a model in different directions.

### A. Conflicting instruction sources

Examples observed during live use:

- some guidance suggests brief timeout check-ins
- other guidance discourages filler notifications and says to stay quiet unless there is substance
- some guidance implies broad Telegram-only communication
- the intended rule is narrower: when loop mode is active, keep substantive conversation in Telegram
- some guidance suggests voice-first behavior
- other guidance treats voice as preference-based

A general-purpose model can comply with one instruction set while violating another.

### B. Stale memory can override live state

Observed hazards from stale session memory:

- old `sid` / `pin`
- outdated task-board state
- stale test counts
- stale assumptions about active role or current branch state

This can lead to incorrect recovery behavior, bad assumptions, or false confidence.

### C. Tool-selection ergonomics are not obvious enough

A recurring failure mode is using a progress artifact when the actual need is only to show visible working presence.

Correct default in most cases:

- `show_animation` for thinking / working presence
- progress bars only when there is real progress to update in place
- checklists only for true multi-step tracked workflows

### D. Failure modes are under-documented

The docs explain the happy path well, but GPT-style agents also need explicit warnings about common mistakes:

- drifting back into the editor chat while loop mode is active
- overusing progress/checklist tools for one-shot presence
- restarting/recovering sessions when simply calling `dequeue_update` again would suffice
- trusting stale memory over live tool state
- trying to “clean up” visible artifacts without operator approval

## Suggested changes

### 1. Add a short instruction-precedence section

Suggested wording:

```text
Instruction precedence in loop mode:
1. active operator instruction
2. loop-mode Telegram communication rules
3. current role prompt (Overseer / Worker)
4. general coding-agent defaults
5. memory notes

If memory conflicts with live tool state or current operator instruction, memory loses.
```

### 2. Add a memory-safety note

Suggested wording:

```text
Treat memory as advisory, not authoritative.
Re-check live session, queue, and board state with tools before acting.
Never trust stored SID/PIN or active-task state without verification.
```

### 3. Add a live-status tool-choice rule

Suggested wording:

```text
Default visible presence tool: `show_animation`.
Use `send_new_progress` only if you will update that same progress message over time.
Use `send_new_checklist` only for real multi-step tracked work.
Do not use progress/checklist tools as one-shot status indicators.
```

### 4. Add a common-failure-modes section

Suggested content:

```text
Common failure modes:
- replying in VS Code while loop mode is active
- restarting the session when normal dequeue loop would work
- trusting stale memory over live tool calls
- using progress/checklist tools for presence instead of actual tracked state
- deleting or mass-cleaning user-visible messages without explicit approval
```

### 5. Clarify loop-mode scope

Suggested wording:

```text
Telegram is not the only conversational surface in every context.
But once the operator explicitly initiates loop mode, substantive operator communication must stay in Telegram until the operator exits that mode or Telegram is unavailable.
```

## Relationship to task 310

- `310-telegram-loop-prompt-clarity.md` should stay focused on the loop invariant and canonical `dequeue_update` recipe.
- This document should stay focused on surrounding operational hazards and instruction/tooling conflicts.

## Acceptance criteria

- [ ] Decide which docs/prompts should own instruction-precedence guidance
- [ ] Add explicit memory-safety wording somewhere loop-related agents will see it
- [ ] Clarify `show_animation` vs progress/checklist tool usage
- [ ] Add a short common-failure-modes section to loop-oriented guidance
- [ ] Clarify that Telegram-only communication is a loop-mode rule, not a universal rule in all contexts

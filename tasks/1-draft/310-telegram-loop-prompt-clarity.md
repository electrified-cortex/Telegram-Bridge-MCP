# Telegram loop prompt clarity for GPT-style agents

**Type:** Process / prompt refinement
**Priority:** 310 (Normal)
**Status:** Draft

## Goal

Capture wording changes that would make the Telegram loop behavior more robust for models that default to a standard request/response chat pattern and may incorrectly treat the VS Code chat panel as an acceptable fallback conversational channel.

## Problem

The current guidance strongly implies the right behavior, but a GPT-style coding agent can still mis-prioritize:

1. Treat VS Code chat as the safe fallback channel when the operator is also present there.
2. Treat session/bootstrap recovery as the main task instead of simply calling `dequeue_update` again.
3. Mix three layers of instruction without a crisp precedence rule:
   - default coding-agent behavior
   - Telegram communication behavior
   - overseer/worker role behavior
4. Interpret "all communication goes through Telegram" too broadly across all contexts, instead of specifically: once the loop is initiated and the operator asks to stay in it, substantive replies must stay there.

## Source references reviewed

- `LOOP-PROMPT.md`
- `docs/communication.md`
- `.github/instructions/telegram-communication.instructions.md`
- `tasks/OVERSEER-PROMPT.md`
- `tasks/WORKER-PROMPT.md`
- `tasks/README.md`

## Observed gap

The documents describe the loop well, but they do not pin down one invariant early and bluntly enough:

> When the operator has initiated the Telegram loop, the agent must keep the conversational surface in Telegram and must not answer substantive operator messages in the VS Code panel unless the operator explicitly exits the loop or Telegram is genuinely unavailable.

Without that explicit invariant, a model can follow the mechanics yet still drift back into the editor chat whenever there is ambiguity.

## Recommended wording changes

### 1. Add an explicit channel-precedence rule near the top

Suggested wording for `LOOP-PROMPT.md` and/or `.github/instructions/telegram-communication.instructions.md`:

```text
If the operator has initiated the Telegram loop, Telegram becomes the active conversational surface.
Do not answer substantive operator messages in the VS Code chat panel while the loop is active.
Use VS Code only for tool execution and hidden coordination.
Return to VS Code chat only if the operator explicitly exits the loop or Telegram tools are unavailable/broken.
```

### 2. Add a minimal canonical loop recipe

Suggested wording:

```text
Canonical loop:
1. dequeue_update(timeout: 300)
2. if update arrives: handle it and reply in Telegram
3. if timed_out: remain in loop and call dequeue_update again
4. only perform session repair if auth/session actually fails
```

This should be placed where it cannot be missed, ideally directly under the setup steps.

### 3. Add an anti-recovery warning

Suggested wording:

```text
Do not restart, shutdown, re-bootstrap, or re-announce the session just because the operator says
"resume the loop" or "stay in the loop." In normal operation, that means: call dequeue_update again.
```

### 4. Clarify instruction precedence

Suggested wording:

```text
Instruction precedence for this repo:
1. Active operator instruction
2. Telegram loop / communication rules when loop mode is active
3. Role prompt (Overseer or Worker)
4. General coding-agent defaults
```

This reduces the chance that default editor-chat behavior overrides the loop.

### 5. Narrow the "all communication" wording

Current wording can be read as a universal rule. The intended rule appears narrower.

Suggested wording:

```text
When Telegram MCP tools are available and the operator has initiated loop mode, all substantive operator communication goes through Telegram.
```

That preserves non-loop use cases while making loop mode strict.

## Why this matters

This is not mainly a tool-usage problem. It is a mode-discipline problem.

The tools already support the correct behavior. The failure mode is that a general coding model defaults to visible responses in the editor unless the prompt makes Telegram-loop mode feel like a strict protocol rather than a preference.

## Additional findings from live use

### 1. Memory hygiene can actively mislead recovery behavior

During live use, stale session-memory entries created false confidence about:

- active `sid` / `pin`
- current board state
- current test counts
- what role constraints were currently in force

This increases the odds of bad session recovery behavior and outdated assumptions.

Suggested guidance:

```text
Session memory is advisory and may be stale.
Do not trust stored SID/PIN, queue state, or active-task state without re-checking live tools.
Prefer a single canonical live-state note or aggressively clear stale session notes on resume.
```

### 2. Some guidance sources conflict with each other

There are places where the instructions are directionally aligned but still create ambiguity for a model:

- timeout handling suggests a brief notify/check-in
- other guidance discourages filler notifications and says to stay quiet unless there is substance
- some guidance pushes voice-first behavior
- other guidance presents `send_text_as_voice` as conditional/preference-based

Suggested fix:

```text
When two communication rules appear to conflict, prefer the more specific rule for the current loop state.
Avoid generic status messages unless the loop documentation explicitly requires them for that situation.
```

### 3. Live-status tool selection is not explicit enough

One repeated failure mode is using a progress artifact when the real intent is simply to show that work is happening.

The correct default visible-presence tool is usually `show_animation`, not a progress or checklist message.

Suggested wording for the communication guide:

```text
Use `show_animation` as the default "I am thinking / working" signal.
Use `send_new_progress` only when you intend to update the same progress message over time.
Use `send_new_checklist` only for real multi-step tracked workflows.
Do not create progress or checklist artifacts for one-shot status signaling.
```

### 4. Failure-mode warnings should be explicit, not implied

The current docs explain the happy path well. They do less to warn about the common wrong paths:

- drifting back into VS Code chat
- overusing progress/checklist tools for presence
- over-recovering sessions instead of just calling `dequeue_update` again
- letting stale memory override live tool state

Adding a short `Common Failure Modes` section would likely help GPT-style agents more than adding more happy-path prose.

## Acceptance criteria

- [ ] Decide which file(s) should carry the stronger loop invariant
- [ ] Update wording so loop mode clearly binds conversational surface to Telegram
- [ ] Add the minimal canonical `dequeue_update` loop recipe
- [ ] Add explicit guidance against unnecessary session recovery/restart behavior
- [ ] Clarify instruction-precedence so Telegram-loop rules override general editor-chat defaults when active
- [ ] Add guidance about stale memory not outranking live Telegram/session state
- [ ] Clarify `show_animation` vs progress/checklist tool selection for live status
- [ ] Consider adding a short `Common Failure Modes` section to loop-oriented docs

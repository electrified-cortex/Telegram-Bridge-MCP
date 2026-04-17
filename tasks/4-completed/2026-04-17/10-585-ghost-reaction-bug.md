# 10-585 — Reaction System Bugs: Ghost Reactions, Base Persistence, Array Ordering

**Priority:** 10 (critical)
**Created:** 2026-04-17
**Reporter:** Curator (observed during live session)

## Problem

Message 36250 (voice message from operator) received a sleeping reaction (😴) despite:

1. The agent (Curator, SID 1) never dequeuing the message
2. The agent never calling `react` on that message ID
3. No explicit action taken by any session on that message

The reaction appeared to be applied server-side without agent request.

## Context

- Curator was processing a batch of recurring reminders between dequeue calls
- The `sleeping` animation preset had just been registered (single frame: "😴 ...")
- Message 36250 arrived during the reminder processing gap
- The message was routed as `ambiguous`

## Possible Causes

1. **Idle detection leak** — the unresponsive/idle detection system may have applied a reaction to the latest unprocessed message
2. **Preset registration side-effect** — registering the `sleeping` preset may have inadvertently applied its frame as a reaction
3. **Race condition** — timing between dequeue batches and incoming message processing

## Also Investigate

- **Base reaction (-100 priority) not persisting** — the `processing` preset was designed with an implicit 👌 base at priority -100 that should survive after temporary reactions clear. In practice, messages are being left bare after processing temporaries expire. Verify the base reaction mechanism is correctly implemented.

- **Preset array ordering bug** — when `processing` preset applies 👀 + 🤔 as an array, the display priority may not resolve correctly. 👀 (higher priority, temporary) should show first, then fall through to 🤔 when 👀 expires. Operator observed incorrect visual ordering — reactions applied in an array need to respect their declared priority order for display.

## Expected Behavior

- No reaction should appear on a message unless explicitly requested by an agent via `react` or a preset
- The -100 priority base reaction should persist after temporary reactions clear

## Recommended Fix

**Implicit base reaction on any `react` call:** When any session calls `react` on a message (directly or via preset), the server should automatically set a permanent 👌 at priority -100 if no base reaction exists yet for that message+session. This ensures:

- Once reacted, always reacted — no bare messages after temporaries clear
- Agents don't need to remember to follow up with a permanent reaction
- Platform-level guarantee vs relying on agent behavior
- Agents *can* explicitly remove the base if they want (edge case, no real reason to)

## Acceptance Criteria

- [x] Root cause identified for ghost reaction on msg 36250
- [x] Fix deployed — no reactions without explicit agent request
- [x] Implicit 👌 base (-100) auto-applied on first `react` call per message
- [x] Base reaction persistence verified with test (temporaries clear → 👌 remains)
- [x] No regression in explicit reaction removal (agent can still clear if desired)
- [x] Preset array reactions display in correct priority order (highest priority visible first)

## Completion

Branch: `10-585`
Worktree: `D:\Users\essence\Development\cortex.lan\Telegram MCP\.worktrees\10-585`
Commit: `3956da5`

Root cause for ghost 😴: poller's `hasSessionWaiterForMessage` guard didn't cover the brief window when the agent was processing a prior event (reminder) between dequeue calls. Fixed with 1500ms delay + `hasPendingWaiters()` re-check.

👌 base persistence: removed background `setMessageReaction("👌")` race. Now wired as `restoreEmoji` in the temp reaction path, marked only after success.

Preset restore chain: `previousLayerEmoji` threaded through `handleSetReactionPreset` loop so each layer restores to the prior one (👀 → 🤔 → clear).

5 files changed, 2 code review iterations, 2353/2353 tests pass.

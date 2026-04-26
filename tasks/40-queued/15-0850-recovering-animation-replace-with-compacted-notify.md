---
id: 15-0850-recovering-animation-replace-with-compacted-notify
title: Recovering animation auto-replaces to "compacted" notify on next agent activity
priority: 15
status: draft
type: feature
delegation: worker
repo: TMCP
---

# Recovering animation auto-replaces with "compacted" info notify on next agent activity

## Problem

After an agent compacts and starts recovering, the bridge shows a "recovering" animation. When the agent comes back online and takes an action (sends a message, fires show-typing, reacts), the recovering animation gets erased — but no trace remains. The operator can't tell at a glance whether the agent is back or whether the prior animation just timed out.

## Expected behavior

When the bridge sees agent activity AFTER a `compacted` event has fired AND the recovering animation is still visible, the bridge auto-replaces the animation with an info-style "compacted" notify. The notify persists in the chat as evidence the agent recovered.

Triggers for replacement:

- Agent sends any new message (text, voice, hybrid, file).
- Agent fires `show-typing`.
- Agent reacts to a message.
- Any other agent-originated activity post-`compacted`.

## Acceptance

- After `compacted` fires for a session, the next agent-originated activity replaces the recovering animation with an info-style notify "compacted" (or similar phrasing).
- The notify persists in the chat — operator can see it as a permanent record of the recovery point.
- If multiple compactions occur in a session, each gets its own replacement notify on next activity.
- If the agent never sends activity after compaction (orphaned), the recovering animation behaves per existing timeout rules (no special replacement).

## Don'ts

- Don't fire the replacement notify on EVERY agent activity — only the first one after `compacted`.
- Don't replace if there's no recovering animation visible (idle case).
- Don't add visible markers if compaction was silent (e.g. governor-suppressed).

## Notes

- Pairs with the existing `compacting` / `compacted` event chain (TMCP 7.2).
- Operator-stated 2026-04-26: "would be awesome if we just replaced it with an info message that says compacted."

## Source

Operator directive 2026-04-26 PM via Curator session.

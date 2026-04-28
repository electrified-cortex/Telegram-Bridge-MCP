---
title: "Auto-pin blocking questions; auto-unpin on resolution"
priority: 15
status: needs-refinement
created: 2026-04-26
repo: Telegram MCP
---

# Auto-pin blocking questions; auto-unpin on resolution

## Operator directive (2026-04-26)

> "Any question that is blocking and waiting for a response needs to be pinned. And then when it's completed as part of its cleanup, it also unpins itself."

## Problem

When an agent sends a `type:"question"` (choose/confirm) and waits for operator response, the message may scroll out of view during an active session. The operator has no persistent visual indicator that a question is waiting. Currently there is no way to distinguish a question that was answered from one still waiting without scrolling up.

## Goal

Blocking questions — those that pause agent flow waiting for operator input — are automatically pinned on send and automatically unpinned when the response is received or the question is cancelled/timed out.

## Proposed behavior

1. On `send(type:"question", ...)` with choose or confirm mode: after the message is sent, the bridge auto-pins it (`message/pin`) silently.
2. On response received (callback_query answer): bridge unpins the message as part of cleanup, before delivering the response to the agent.
3. On timeout or cancellation: bridge unpins the message.
4. Applies to all blocking question types (choose and confirm), NOT to non-blocking question types (ask-mode free-text may not need pinning — Curator to decide scope).

## Scope questions for Curator

- Should `ask`-mode (free-text) questions also be pinned?
- Should pinning be opt-in (a param on `send`) or always-on for blocking questions?
- What if pin fails (permissions)? Silent continue or surface warning?
- DM channel questions: pin is less relevant in DMs — exclude DM-routed questions?

## Don'ts

- Do not pin non-question messages
- Do not leave messages pinned on agent shutdown — cleanup on close
- Do not send a pin notification to the chat (use `disable_notification: true` on pin)

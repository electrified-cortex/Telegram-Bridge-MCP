---
id: "feat-auto-pin"
title: "Auto-pin blocking questions; auto-unpin on resolution"
priority: 15
status: needs-refinement
created: 2026-04-26
updated: 2026-06-21
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
branch: dev
dispatch_ready: true
needs_operator: false
---

# Auto-pin blocking questions; auto-unpin on resolution

## Operator directive (2026-04-26)

> Source: operator voice, 2026-04-26 (distilled). Any blocking question awaiting a response must be pinned, and must unpin itself as part of its cleanup once resolved.

## Problem

When an agent sends a `type:"question"` (choose/confirm) and waits for operator response, the message may scroll out of view during an active session. The operator has no persistent visual indicator that a question is waiting. Currently there is no way to distinguish a question that was answered from one still waiting without scrolling up.

## Goal

Blocking questions — those that pause agent flow waiting for operator input — are automatically pinned on send and automatically unpinned when the response is received or the question is cancelled/timed out.

## Proposed behavior

1. On `send(type:"question", ...)` with choose or confirm mode: after the message is sent, the bridge auto-pins it (`message/pin`) silently.
2. On response received (callback_query answer): bridge unpins the message as part of cleanup, before delivering the response to the agent.
3. On timeout or cancellation: bridge unpins the message.
4. Applies to all blocking question types (choose and confirm), NOT to non-blocking question types (ask-mode free-text may not need pinning — Curator to decide scope).

## Scope decisions (resolved 2026-06-21)

- **`ask`-mode (free-text) questions:** NOT pinned. Pinning applies only to blocking choose/confirm questions — free-text ask does not block agent flow.
- **Opt-in vs always-on:** always-on for blocking choose/confirm. Opt-in would defeat the persistent-indicator goal.
- **Pin failure (permissions):** silent continue. Log the failure at debug level; do not surface to operator; do not fail the `send` call.
- **DM channel questions:** excluded from auto-pin. Pin semantics in DMs are irrelevant and may error; apply only to group/supergroup chats.

## Acceptance Criteria

- [x] `send(type:"question", mode:"choose"|"confirm")` in a non-DM chat automatically pins the sent message after delivery (`disable_notification: true` on pin call).
- [x] On callback_query answer received: bridge unpins the message before delivering response to agent.
- [x] On timeout or cancellation of a blocking question: bridge unpins the message.
- [x] `ask`-mode (free-text) questions are NOT pinned.
- [x] DM-routed questions are NOT pinned (DM chat type detection gates the pin call).
- [x] Pin failure is caught silently — logged at debug, does not fail the send or raise an error to the caller.
- [x] No messages are left pinned on agent shutdown — cleanup pass on session close unpins any open question pins.
- [x] Pin notifications are suppressed (`disable_notification: true` on all pin calls).
- [x] Tests cover: choose/confirm in group chat (pins), ask in group chat (no pin), DM question (no pin), pin permission failure (silent), timeout unpin, cancellation unpin.

## Verification

APPROVED by verifier ac1cf2b4e545178a4 — all 8 ACs confirmed, 3795/3795 tests pass (157 files), clean worktree. Squash b9dd58bc on release/v7.11.1, rebased onto 106622aa.

## Don'ts

- Do not pin non-question messages
- Do not leave messages pinned on agent shutdown — cleanup on close
- Do not send a pin notification to the chat (use `disable_notification: true` on pin)

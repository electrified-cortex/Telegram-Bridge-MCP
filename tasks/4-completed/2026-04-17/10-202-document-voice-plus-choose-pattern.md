---
Created: 2026-04-03
Status: Draft
Priority: 10
Source: Operator feedback (voice, session 2026-04-03)
Repo: electricessence/Telegram-Bridge-MCP
Branch target: dev
---

# 10-202: Document Voice + Choose Pattern in Agent Guide

## ⚠️ Triage Note (2026-04-14)

Likely stale — references v5 API (send_text_as_voice, choose). Core intent (document voice+decision pattern) may still apply in v6 with send(audio:) + send(type: "question", choose:). Needs rewrite if kept.

## Problem

When an agent uses `send_text_as_voice` with a manual `reply_markup`, the inline
keyboard stays visible after the operator clicks a button. This is because the
auto-removal logic lives in `choose` and `confirm` — not in `send_text_as_voice`.

Agents that want voice + decision buttons have been combining them incorrectly,
leading to stuck keyboards and expired callback queries.

## Goal

Document the correct pattern for voice messages that require a decision button,
and ensure agents learn it at startup.

## Correct Pattern

```
1. send_text_as_voice(text: "...your question...")
2. choose(question: "...", options: [...])   ← auto-handles keyboard removal
```

NOT:
```
send_text_as_voice(text: "...", reply_markup: {...})   ← keyboard sticks
```

## Scope

Update `get_agent_guide` response (or the relevant section of the agent guide
documentation) to include:

1. A "Voice + Decision" pattern with the correct two-step approach
2. A warning note: "Never attach reply_markup to send_text_as_voice"
3. A brief explanation of why: choose/confirm auto-remove keyboards, manual
   reply_markup does not

## Acceptance Criteria

- [ ] Agent guide includes voice + choose pattern documentation
- [ ] Warning about reply_markup on voice is explicit
- [ ] Correct pattern is shown with code example

## Reversal Plan

Revert the agent guide update. No schema or data migration needed.

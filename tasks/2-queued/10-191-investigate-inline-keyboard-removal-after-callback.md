---
Created: 2026-04-03
Status: Draft
Priority: 10
Source: Operator directive (voice)
Repo: electricessence/Telegram-Bridge-MCP
Branch target: dev
---

# 10-191: Investigate Inline Keyboard Not Removed After Callback

## Problem

When an agent sends a message with an inline keyboard (`reply_markup`) and the
operator clicks a button, the keyboard remains visible in the Telegram chat —
the buttons do not disappear or update after the callback is received.

This is confusing UX — the operator cannot tell whether their click was registered.

## Context

The `choose` and `confirm` tools auto-handle keyboard removal after a button press.
But when agents use `send_text_as_voice` (or `send_message`) with a manual
`reply_markup`, the keyboard is never removed because:

1. The callback arrives via `dequeue_update` as a `callback` event.
2. The agent calls `answer_callback_query` to acknowledge (or it expires).
3. But nothing edits the original message to remove or replace the inline keyboard.

The `choose` and `confirm` tools presumably call `editMessageReplyMarkup` (or
equivalent) after the callback fires. Manual flows miss this step.

## Scope

1. **Audit `choose.ts` and `confirm.ts`** — find the exact mechanism they use to
   remove the inline keyboard after callback. Is it `editMessageReplyMarkup`?
   Is it handled in the callback ack? Or is it a Telegram API feature on ack?

2. **Check if `answer_callback_query` auto-removes keyboards** — some Telegram
   clients remove the keyboard on ack; others don't. Determine actual behavior.

3. **Identify the fix** — either:
   a. The agent must call `edit_message` (remove keyboard) after callback, OR
   b. The MCP should auto-remove keyboards on `answer_callback_query`, OR
   c. A new helper tool should combine ack + keyboard removal.

4. **Implement the fix** — whichever approach is cleanest.

5. **Update agent guidance** — if agents must manually remove keyboards, add a
   note to the agent guide explaining the pattern.

## Acceptance Criteria

- [ ] Root cause documented (how `choose`/`confirm` handle keyboard removal)
- [ ] Inline keyboards are removed/updated after operator clicks a button
- [ ] `send_text_as_voice` with `reply_markup` + callback flow works cleanly
- [ ] Existing `choose`/`confirm` behavior unchanged
- [ ] Tests updated if applicable

## Reversal Plan

Revert commits. No schema or data migration needed.

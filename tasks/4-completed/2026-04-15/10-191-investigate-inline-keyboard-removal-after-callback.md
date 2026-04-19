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

## Activity Log

- **2026-04-15** — Pipeline started. Variant: Design + Implement.
- **2026-04-15** — [Stage 2] Feature Designer dispatched. Design received (7 sections). Root cause confirmed: `answerCallbackQuery` does not remove keyboards; explicit `editMessageReplyMarkup` required. Selected Approach B (add `remove_keyboard` param to existing tool).
- **2026-04-15** — [Stage 3] Design reviewed. Clean — all 7 sections present, criteria verifiable, no implementation code, 3 OQs all non-blocking with stated defaults.
- **2026-04-15** — [Stage 4] Task Runner dispatched. 5 files changed (137 insertions). Build verifier: 2223/2223 tests pass, TypeScript clean.
- **2026-04-15** — [Stage 5] Verification: diff non-empty, 2223 tests passed.
- **2026-04-15** — [Stage 6] Code Reviewer iteration 1: 2 major, 2 minor. Fixed: stderr warning for resolveChat failure + test, action.test.ts integration test, describe nesting, action.ts description update.
- **2026-04-15** — [Stage 6] Code Reviewer iteration 2: 1 major (misleading test name). Fixed: test renamed to accurately reflect mock-based arg-forwarding coverage.
- **2026-04-15** — [Stage 6] Code Reviewer iteration 3: Clean — no Critical or Major. 2 info (pre-existing, not introduced by PR).
- **2026-04-15** — [Stage 7] Complete. Branch: 10-191, commit: ca518df. Ready for Overseer review.

## Completion

Added `remove_keyboard?: boolean` and `message_id?: number` optional parameters to the `answer_callback_query` tool. When `remove_keyboard: true`, the tool calls `editMessageReplyMarkup` after the ack to clear the inline keyboard. Edit failures are non-fatal (logged to stderr, ack still succeeds). Missing `message_id` returns `MISSING_MESSAGE_ID` error before any API call. The `action(type: "acknowledge")` path forwards the new parameter correctly. Docs updated with Manual Keyboard Removal pattern and combined-call guidance.

Subagent passes: Feature Designer ×1, Task Runner ×2, Code Reviewer ×3.
Final review: 0 critical, 0 major, 0 minor (2 info — pre-existing, not regressed).

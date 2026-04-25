---
id: 05-0825
title: send type:question — answer callback edits text but inline keyboard not removed
priority: 5
status: draft
type: bug-fix
delegation: any
---

# send type:question — buttons not cleared after answer

After an operator answers a `send(type: "question", choose: [...])` message, the bridge edits the message text to show the selection (e.g. "▸ Bump to 7.2.0 now") but the inline keyboard remains visible. Tapping a stale button after answering would re-fire a callback against an already-resolved question.

## Reproduction (today's session)

1. Curator session sent `send(type: "question", choose: [{label: "Bump to 7.2.0 now", value: "bump"}, ...])`.
2. Telegram delivered the message with three buttons; bridge returned `message_id: 42747`.
3. Operator tapped "Bump to 7.2.0 now".
4. Bridge returned `{value: "bump", label: "Bump to 7.2.0 now", message_id: 42747}` to caller.
5. Operator observed: message text updated to show the selection, but buttons remained tappable on the same message.
6. Operator: "the message updated the text but didn't clear the buttons. I need you to follow up on this, that this is a bug."

## Expected behavior

After a question is answered:
- Message text reflects the selection (already correct).
- Inline keyboard is removed (`reply_markup: { inline_keyboard: [] }` or `null`) in the same edit, so no buttons remain.
- Late taps on the original keyboard fail with the standard expired-callback handling (see existing 05-204 work in branch list).

## Possible regression source

Operator hint (2026-04-25): "It's the first time I've seen that that I can recall, and it might be a side effect of our new async message queue or whatever we got."

The async-default audio change (task 10-820) and the async-send-queue refactor for recording-indicator coordination both landed in the v7.2.0 cycle. If the question-answer edit path is now routing through the async queue (or sharing state with it), the keyboard-removal step may be getting dropped between the queue's edit emission and the underlying `editMessageText` call. Investigate whether question-answer edits go via the same queue path as audio sends, and whether `reply_markup` is preserved across that hop.

## Likely site

Whatever code path handles `callback_query` resolution for `send(type: "question")` messages and edits the text. Check whether `editMessageText` is being called without `reply_markup`, vs `editMessageReplyMarkup` after — only one of them will actually drop buttons. If the implementation calls `editMessageText` first then `editMessageReplyMarkup` and the second call silently fails (e.g. the markup is already implicitly cleared by editMessageText), the bug is in error handling. If only `editMessageText` is called, that's the missing path.

Telegram Bot API note: `editMessageText` does NOT clear inline keyboards by itself; it preserves any existing reply_markup unless explicitly overridden. The fix is to include `reply_markup: { inline_keyboard: [] }` in the same `editMessageText` call (or call `editMessageReplyMarkup` separately).

## Acceptance criteria

- After any `send(type: "question")` is answered (any preset: ok, ok-cancel, yn, choose), the message has zero inline buttons.
- Test: simulate callback_query, assert resulting message has no `reply_markup` or empty inline_keyboard.
- Stale-button tap on an answered question returns the standard expired-callback response (no double-resolve).

## Out of scope

- Question timeout path (separate concern).
- Plain `send(type: "choice")` non-blocking buttons (verify but probably already handled).

## Related

- `feedback_callback_ack_first` (Curator memory) — adjacent acknowledgment-protocol concern.
- Existing branch `05-204-expired-callback-button-cleanup` — possibly addresses the stale-button side; verify scope overlap.

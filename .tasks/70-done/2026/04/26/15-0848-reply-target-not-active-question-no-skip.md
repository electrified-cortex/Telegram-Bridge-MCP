---
id: 15-0848-reply-target-not-active-question-no-skip
title: Reply to non-active-question message should NOT skip the active question
priority: 15
status: draft
type: bug-fix
delegation: worker
repo: TMCP
---

# Reply to non-active-question message should NOT skip the active question

## Problem

When the operator replies to a Telegram message that is NOT the currently-active question / confirm prompt — for example, replying to a message 10 messages above the active prompt — the bridge currently treats that reply as a "skip" on the active question. This causes confirm/question prompts to resolve as `skipped` even though the operator was answering an unrelated message.

## Expected behavior

A reply should only resolve the active question when:

1. The reply's `reply_to` message ID matches the active question's message ID, OR
2. The reply is ambiguous (no `reply_to` set, no other context that distinguishes it).

A reply that targets a different message ID — and that target is NOT the active question — should be delivered as a normal message and should NOT change the state of the active question.

## Reproducer

1. Curator sends a confirm prompt as message N.
2. Operator scrolls up, replies to a message K (where K < N and K != active-question target).
3. Confirm prompt currently returns `skipped: true` even though operator never targeted message N.

Expected: confirm prompt remains pending; reply gets delivered as a normal message.

## Acceptance

- Bridge inspects `reply_to_message_id` on every incoming reply.
- If the reply's target equals the active question's message ID → treat as answer / skip per existing semantics.
- If the reply's target is some other message ID → deliver as a regular message, do NOT change active-question state.
- If no `reply_to` is set (ambiguous) → existing behavior (skip / route by current state).
- Test: send a reply targeting a stale message while a confirm is pending; assert the confirm remains pending and the reply is queued for the appropriate session.

## Don'ts

- Don't change semantics for replies that DO target the active question. Skip behavior for those is correct.
- Don't change ambiguous-reply behavior.
- Don't break the auto-salute on voice replies.

## Notes

- Affects only the operator session (Curator). Other sessions don't currently have this confusion.
- Operator-flagged 2026-04-26 PM during a multi-thread session where unrelated replies were unintentionally resolving live confirm prompts.

## Source

Operator directive 2026-04-26 PM via Curator session.

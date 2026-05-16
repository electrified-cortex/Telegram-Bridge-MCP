---
id: "30-1928"
title: "question: 'replied' resolution when answered by direct text reply (not 'skipped')"
type: feature
priority: 30
created: 2026-05-15
delegation: Worker
target_branch: dev
---

# 30-1928 — question: 'replied' resolution when answered by direct text reply

## Context

Today, when a `send(type: "question", ...)` call posts a question with buttons, there are two ways the operator can answer:

1. Click one of the inline buttons → resolved as `chosen` / `confirmed` / similar (the button's `value`).
2. Ignore the buttons and reply directly to the question message with text.
3. Let the question time out → resolved as `skipped`.

Path (2) currently resolves as `skipped` — same bucket as the timeout path. That's misleading: a direct text reply IS an answer, just outside the button options. The receiving agent should be able to distinguish "operator engaged with text" from "operator never answered."

## Acceptance criteria

1. When the operator answers a pending question by sending a Telegram message that is a `reply_to` the question's message ID (and not a button callback), TMCP records the resolution as `replied` (new resolution kind), with the reply's text content captured in the resolution payload.
2. The agent's pending `send(type: "question", ...)` promise (or whatever surfaces the resolution to the caller) returns `{ resolution: "replied", text: "<reply body>" }` — distinct from `chosen` / `confirmed` / `skipped` / `timeout`.
3. `skipped` is reserved strictly for: operator dismissed the question (e.g., via skip button if exists) without text or button choice.
4. `timeout` remains its own kind (no operator action within `timeout_seconds`).
5. Help docs (`help('send')`, `help('guide')`) updated to describe `replied`.

## Out of scope

- Threading / multi-message replies (first reply wins; subsequent replies are normal messages).
- Reply-detection for non-question sends (only `type: "question"` cares about resolution).
- Routing the reply text to NLP / intent matching — caller decides what to do with it.

## Source

- Operator request 2026-05-15 (post-compaction): "if a question is asked with buttons that would normally convert to a skipped, I want it to be that if it's actually replied to — like if it's something that I actually directly reply to that message — instead of saying skipped, it should say replied."

## Verification

APPROVED — All 5 criteria confirmed. Pass 2 added `### Question resolution kinds` table to `docs/help/guide.md` covering `replied`, `chosen`/`confirmed`, `skipped`, and `timeout` with conditions and payload shapes. Core implementation: `reply_to === question message_id` guard in ask/choose/confirm handlers returns `{ resolution: "replied", text, message_id }`. 3033 tests pass. Squash-merged as `16d27c72`.

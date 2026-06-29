# WARN-2: Caption limit check uses pre-topic length

## Source
Surfaced by adversarial review of PR #259 (story 10-3055 gate bounce).

## Problem

In `src/tools/send.ts`, the caption-length guard for same-message delivery checks the length of
the text before `applyTopicToText` is called. If the topic prefix is long (e.g. a multi-word
topic), the final caption can exceed Telegram's caption limit (1024 characters) even though the
pre-topic check passed. The sendDocument call would then fail with a Telegram API error.

## Acceptance Criteria

- [ ] Caption length check must use the **post-topic** text length (after `applyTopicToText`).
- [ ] Test: supply a text + topic that together exceed 1024 characters but the pre-topic text
  alone does not; assert the same-message path is NOT attempted (or falls back gracefully).
- [ ] `pnpm build` clean; `pnpm test` passes.

## Non-goals

- No changes to topic logic itself.

## Filed by

Worker `10-3055` on 2026-06-29 per gate-bounce BLOCK-1 adversarial review.

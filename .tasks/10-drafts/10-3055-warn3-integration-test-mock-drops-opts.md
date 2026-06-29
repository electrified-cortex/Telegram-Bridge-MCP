# WARN-3: Integration test mock drops `opts` on sendMessage

## Source
Surfaced by adversarial review of PR #259 (story 10-3055 gate bounce).

## Problem

In `src/tools/send.visual-pipeline.test.ts`, the `sendMessage` mock (`mocks.sendMessage`) does
not capture or forward `opts` (the third argument, containing `parse_mode`,
`disable_notification`, `reply_parameters`, etc.). Tests that check ordering or delivery
outcomes do not verify whether the correct `opts` were passed. This can mask bugs where the
wrong parse mode or reply reference is used in multi-chunk or queued delivery paths.

## Acceptance Criteria

- [ ] The `sendMessage` mock should preserve `opts` so tests can assert correct option values.
- [ ] Add at least one assertion for `parse_mode` and/or `reply_parameters` on the prose
  sendMessage call in a relevant delivery-path test.
- [ ] `pnpm build` clean; `pnpm test` passes.

## Non-goals

- No changes to production code in this story — test-only fix.

## Filed by

Worker `10-3055` on 2026-06-29 per gate-bounce BLOCK-1 adversarial review.

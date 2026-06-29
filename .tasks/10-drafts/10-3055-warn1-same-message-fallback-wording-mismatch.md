# WARN-1: Same-message fallback wording mismatch on sendDocument throw

## Source
Surfaced by adversarial review of PR #259 (story 10-3055 gate bounce).

## Problem

In `src/tools/send.ts`, the same-message delivery path (around the `sendDocument` call for
same-message mode) can throw. When it does, execution falls through to the follow-up delivery
path. However, the placeholder text embedded in the prose was already set to same-message
wording (e.g. "see attachment") before the `sendDocument` call. After the fallback, the prose
contains same-message wording but the actual delivery is follow-up — a wording mismatch.

## Acceptance Criteria

- [ ] When same-message `sendDocument` throws and execution falls through to follow-up delivery,
  the placeholder wording in the prose must be updated (or re-rendered) to reflect the actual
  follow-up delivery mode ("see following attachment" / "see following message").
- [ ] Test: force the same-message `sendDocument` to throw, assert the delivered prose contains
  follow-up wording and that a follow-up `sendDocument` is subsequently called.
- [ ] `pnpm build` clean; `pnpm test` passes.

## Non-goals

- No changes to detection logic, regex patterns, or extraction rules.

## Filed by

Worker `10-3055` on 2026-06-29 per gate-bounce BLOCK-1 adversarial review.

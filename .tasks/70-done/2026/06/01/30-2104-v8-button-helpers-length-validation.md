---
Created: 2026-05-27
Status: backlog
Priority: medium
Source: 2026-05-27 refactor scan
---

# button-helpers.ts — Validate label and callback_data length in buildKeyboardRows()

## Problem

`src/tools/button-helpers.ts:388–430` — `buildKeyboardRows()` concatenates button `text` and `value` (callback_data) directly without checking Telegram's limits:
- Label text: max 64 chars
- callback_data: max 64 chars

If an agent or tool passes values exceeding these limits, the Telegram API rejects silently. The validation happens in `send/choose.ts` for symbol parity but NOT for length, and `send/choice.ts` may skip the check entirely.

## Action

1. Add label length check (`text.length <= 64`) in `buildKeyboardRows()`.
2. Add callback_data length check (`value.length <= 64`) in `buildKeyboardRows()`.
3. Return a clear error (not silent) when limits are exceeded.
4. Audit `send/choose.ts` and `send/choice.ts` to confirm they both run through `buildKeyboardRows()` for consistent coverage.

## Acceptance Criteria

- [x] `buildKeyboardRows()` rejects labels > 64 chars with a named error.
- [x] `buildKeyboardRows()` rejects callback_data > 64 chars with a named error.
- [x] Both `send/choose.ts` and `send/choice.ts` use the same validation path.
- [x] Tests cover the rejection paths.

## Overseer review
- reviewer: Overseer SID-3
- date: 2026-06-01
- verdict: PASS
- review type: adversarial dispatch
- checked: target file confirmed (src/tools/button-helpers.ts, buildKeyboardRows at line 388), both call sites confirmed (send/choose.ts, send/choice.ts), ACs binary (reject >64 chars, named error, tests cover rejection), scope tightly bounded

## Verification

- **Verdict:** APPROVED
- **Date:** 2026-06-01
- **Verifier:** dispatched sub-agent (read-only)
- **Squash commit:** `d26f975` on `dev`
- **Worker commit:** `b0f33c69` on `worker/30-2104-v8-button-helpers-length-validation`
- **Test evidence:** 52/52 tests pass, tsc clean, build clean
- **Named errors:** `ButtonLabelTooLongError`, `ButtonDataTooLongError` — both extend Error, thrown in `buildKeyboardRows()`

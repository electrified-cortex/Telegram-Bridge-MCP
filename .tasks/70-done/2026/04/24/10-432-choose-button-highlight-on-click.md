---
Created: 2026-04-09
Status: Draft
Host: local
Priority: 10-432
Source: Operator (interactive testing session)
---

# Choose Button — Highlight Clicked Option

## Objective

After a user clicks a button in a `choose`/`choice` response, edit the inline
keyboard to visually confirm the selection by highlighting the clicked button in
the primary color.

## Context

During interactive testing, the operator noted that clicking a choose button
gives no visual feedback — the selection is silently registered. For non-blocking
`choice` type especially, the user can't tell if the click was registered.

Telegram supports editing inline keyboards on existing messages via
`editMessageReplyMarkup`. After receiving a callback query, the bridge should:

1. Answer the callback query (already done)
2. Edit the message's inline keyboard to highlight the selected button

Design options:
- Replace clicked button with primary-style version, leave others unchanged
- Replace clicked button with primary-style, dim/remove others
- Add a ✓ prefix to the clicked button label

The operator prefers: clicked button switches to primary color.

## Acceptance Criteria

- [ ] After a choose/choice callback, the clicked button is re-rendered with
      primary style
- [ ] Other buttons remain unchanged (not removed)
- [ ] Works for both blocking `choose` (type: "question") and non-blocking
      `choice` (type: "choice")
- [ ] Add tests for button re-render after callback
- [ ] No regression in existing choose/choice flow

## Completion

Implemented on branch `10-432`. Commit `2290cd2`.

**Approach:** Added `buildHighlightedRows(options, columns, clickedValue)` to
`button-helpers.ts` — maps over the original options and sets `style: "primary"`
on the clicked button while leaving others unchanged, then delegates to the
existing `buildKeyboardRows`. Modified `appendSuffixAndEdit` to accept an optional
`replyMarkup` parameter (defaults to `{ inline_keyboard: [] }` — backward-compat).
Modified `ackAndEditSelection` to accept optional `highlightedRows` and pass them
as `reply_markup` when present.

Updated callback hooks in `send_choice.ts` and `choose.ts` to call
`buildHighlightedRows` and pass the result to `ackAndEditSelection`.

**Changed files (6):**
- `src/tools/button-helpers.ts`: +`buildHighlightedRows`, modified `appendSuffixAndEdit`, modified `ackAndEditSelection`
- `src/tools/send_choice.ts`: updated one-shot hook to pass highlighted rows
- `src/tools/choose.ts`: updated callback hook to pass highlighted rows
- `src/tools/button-helpers.test.ts`: 5 new tests (`buildHighlightedRows`, `ackAndEditSelection` with rows)
- `src/tools/send_choice.test.ts`: updated existing hook test; added new highlight test
- `src/tools/choose.test.ts`: updated 3 `ackAndEditSelection` call assertions

Build: clean (tsc + biome). Lint: clean. Tests: 2489/2489 passed (full suite).
Code review: `minor_only` — no regressions; one additional no-match test added per review finding.

## Verification

**Verifier:** Overseer (Sonnet dispatch, 2026-04-24)
**Verdict:** APPROVED

- AC1 (clicked button re-rendered primary): PASS — `buildHighlightedRows` sets `style: "primary"` on matching button; flows through `ackAndEditSelection` in both choose.ts and send_choice.ts
- AC2 (other buttons unchanged): PASS — non-clicked buttons keep original style; tests assert unstyled buttons remain unstyled
- AC3 (works for blocking and non-blocking): PASS — both `choose.ts` (blocking) and `send_choice.ts` (non-blocking) updated; voice path also covered
- AC4 (tests for re-render): PASS — 5 new `buildHighlightedRows` tests, updated `ackAndEditSelection` assertions, new hook invocation test in `send_choice.test.ts`
- AC5 (no regression): PASS — `appendSuffixAndEdit` defaults to `{ inline_keyboard: [] }` preserving prior behavior; existing confirm/skip/timeout paths untouched
- TypeScript: clean (zero errors)
- Tests: 100/100 passing across relevant test files

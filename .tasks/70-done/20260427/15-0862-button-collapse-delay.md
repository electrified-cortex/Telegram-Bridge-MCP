---
id: 15-0862-button-collapse-delay
title: Add ~250ms delay between button click color-flip and message collapse
priority: 15
status: draft
type: ux
delegation: worker
repo: TMCP
---

# Add ~250ms delay between button click color-flip and message collapse

## Problem

When the operator clicks an inline keyboard button on a `choice` or `confirm` send, two things happen in rapid succession:

1. The button color flips to indicate selection (Telegram-side behavior).
2. The bridge collapses the inline keyboard into the chosen value, replacing the button row with the selected text in the message body.

The transition is functionally correct but feels rushed — the click acknowledgment and the collapse happen so close together that the visual feedback doesn't register as a discrete moment.

## Expected behavior

After the button is clicked:

1. Telegram-side color-flip fires immediately (no change here — already perfect).
2. Bridge waits ~250ms.
3. Bridge then performs the keyboard removal + value substitution in the message body.

The delay is short enough not to feel sluggish, long enough to register the click as a deliberate moment.

## Acceptance

- After a button click on `choice` / `confirm` / `acknowledge`-style sends, there is a ~250ms gap between the visual color-flip and the keyboard collapse.
- Behavior is the same across all interactive types that collapse keyboards.
- No new errors or race conditions if the operator clicks again within the delay window.
- Configurable threshold acceptable but a constant ~250ms is fine for v1.

## Don'ts

- Don't add the delay to the callback acknowledgment itself (must remain immediate per Telegram API expectations).
- Don't add the delay to non-interactive sends (no buttons to collapse).
- Don't make the delay so long that it feels sluggish (>500ms is too much).

## Notes

Operator-stated 2026-04-26 PM (distilled): the experience is good overall; requested adding about a quarter-second delay after a button is clicked before it collapses into the selected value in the message.

UX polish, not blocking. Pairs with the existing button + interactive-message infrastructure.

## Source

Operator directive 2026-04-26 evening via Curator session.

## Completion

**Branch:** `15-0862-button-collapse-delay`
**Commit:** `a264e94a`
**Date:** 2026-04-27

### Summary

Added `BUTTON_COLLAPSE_DELAY_MS = 250` constant (exported) to `button-helpers.ts`. Delay is gated inside `if (callbackQueryId)` in `ackAndEditSelection` so calls without a real button press incur zero delay. Persistent mode in `choice.ts` passes `delayMs=0` to skip the delay on highlight updates. `highlightThenCollapse` default bumped from 150ms to the constant. `acknowledge/query.ts` now imports the constant for its `remove_keyboard` collapse path. All test timer advances updated; new fake-timer test in `query.test.ts` verifies gate behavior. 2930/2930 tests pass.

### Changed files

- `src/tools/button-helpers.ts` — constant, gated delay, delayMs param, JSDoc fix
- `src/tools/send/choice.ts` — persistent path passes delayMs=0, comment updates
- `src/tools/acknowledge/query.ts` — import and use BUTTON_COLLAPSE_DELAY_MS
- `src/tools/acknowledge/query.test.ts` — fake-timer gate test added
- `src/tools/button-helpers.test.ts` — timer advances updated to 300ms
- `src/tools/send/choice.test.ts` — timer advances and persistent-mode ticks updated
- `src/multi-session-callbacks.test.ts` — 300ms real-timer waits after button press
- `src/tools/callback-edge-cases.test.ts` — timer advances updated
- `src/tools/interactive-flows.integration.test.ts` — timer advances updated
- `src/tools/signal-abort.test.ts` — timer advance updated

## Verification

**Verdict:** APPROVED
**Date:** 2026-04-27
**Criteria:** 4/4 passed
**Evidence:** `BUTTON_COLLAPSE_DELAY_MS = 250` exported constant used in all three keyboard-collapse paths (`ackAndEditSelection`, `highlightThenCollapse`, `acknowledge/query.ts`); delay gated strictly inside `if (callbackQueryId)`; persistent path passes `delayMs=0`; fake-timer gate test in `query.test.ts` verifies <250ms gap and >250ms fire.

# 091 — Button Symbol Parity Enforcement

**Priority:** 091
**Status:** Draft → Queue
**Created:** 2026-03-18

## Problem

The documentation mandates "all-or-nothing" for emoji/symbols in button labels — if any button has an emoji, all must. The server validates label LENGTH but not symbol parity. Inconsistent buttons look sloppy.

## Proposed Change

In `choose.ts` and `confirm.ts`, before sending the inline keyboard:

1. Detect which labels contain emoji/unicode symbols
2. If some labels have symbols and others don't, return `BUTTON_SYMBOL_PARITY` error with guidance
3. Include a `force` flag (e.g., `ignore_parity: true`) to override if the agent insists

Error response shape:

```json
{
  "code": "BUTTON_SYMBOL_PARITY",
  "message": "Button labels are inconsistent: 2 of 3 have emoji. Either add emoji to all labels or remove them. Pass ignore_parity: true to send anyway.",
  "labels_with_emoji": ["✅ Yes", "❌ No"],
  "labels_without_emoji": ["Maybe"]
}
```

## Implementation

Add a shared helper in a new file (`src/button-validation.ts` or similar):

```typescript
function hasEmoji(text: string): boolean {
  return /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(text);
}

function checkButtonSymbolParity(labels: string[]): { ok: boolean; with: string[]; without: string[] }
```

Apply in `choose.ts` and `confirm.ts` before building the inline keyboard. Add `ignore_parity` to their input schemas (optional boolean, default false).

## Code Path

- New: `src/button-validation.ts` — shared emoji detection + parity check
- `src/tools/choose.ts` — add guard before keyboard build, add `ignore_parity` input
- `src/tools/confirm.ts` — add guard before keyboard build, add `ignore_parity` input
- `src/tools/send_choice.ts` — add guard (non-blocking version of choose)

## Acceptance Criteria

- [x] Guard detects mixed emoji/no-emoji button labels
- [x] Error response includes which labels have emoji and which don't
- [x] Error message includes guidance to fix or force
- [x] `ignore_parity: true` bypasses the check
- [x] All-emoji and no-emoji label sets pass silently
- [x] Tests: mixed labels rejected, uniform labels pass, force flag works (11 unit tests in `button-validation.test.ts`; 1459 tests total passing)
- [x] Build clean, lint clean, all tests pass
- [x] `changelog/unreleased.md` updated

## Completion

Implemented 2026-03-19. Created `src/button-validation.ts` with `hasEmoji()` and `validateButtonSymbolParity()`. Integrated into `choose.ts`, `confirm.ts`, and `send_choice.ts` — each has `ignore_parity: z.boolean().optional()` in their input schema. `confirm.ts` guard only activates when both buttons are shown (skips single-button CTA mode). 11 unit tests added in `src/button-validation.test.ts`. All 1459 tests pass, build and lint clean.

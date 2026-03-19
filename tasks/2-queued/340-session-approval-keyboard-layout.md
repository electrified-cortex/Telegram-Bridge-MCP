# 340 — Improve session approval keyboard layout

**Priority:** 340 (Normal)
**Type:** UX
**Status:** Queued
**Created:** 2026-03-19
**Source:** Operator feedback

## Problem

The session approval prompt in `session_start.ts` puts all color buttons AND the deny button on a single row:

```
[🟦 🟩 🟨 🟧 🟥 🟪 ✗ Deny]
```

Two issues:
1. **Deny button is cramped** — squeezed alongside 6 color emoji buttons, making it small and hard to tap
2. **No default color emphasis** — `getAvailableColors(colorHint)` sorts the hinted color first, but it has no visual styling to indicate it's the suggested default

## Code Path

- `src/tools/session_start.ts` L31-43: `requestApproval()` builds the inline keyboard
- `src/session-manager.ts` L75: `getAvailableColors(hint?)` — returns palette with hint first

## Fix

1. **Split into two rows**: colors on row 1, deny on row 2
```ts
inline_keyboard: [
  colorButtons,                                          // row 1: color choices
  [{ text: "⛔ Deny", callback_data: APPROVAL_NO }]     // row 2: deny alone
],
```

2. **Optional: highlight the hint color** — if the hint color is available (first in `colorButtons`), consider a visual indicator. Options:
   - Wrap the hint emoji in brackets: `[🟩]` vs `🟩`
   - Or just rely on the leftmost-position as enough emphasis

## Acceptance Criteria

- [ ] Deny button is on its own row, separate from colors
- [ ] Colors remain on a single row
- [ ] Color hint still appears first (existing behavior)
- [ ] Approval/deny flow still works (test existing tests)
- [ ] Build passes, all tests pass
- [ ] Changelog entry added

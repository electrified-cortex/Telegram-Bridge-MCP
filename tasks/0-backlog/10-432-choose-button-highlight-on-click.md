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

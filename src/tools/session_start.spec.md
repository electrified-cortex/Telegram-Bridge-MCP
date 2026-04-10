# Session Start — Approval Dialog Spec

This spec governs the agent approval dialog presented to the operator when an agent requests a session.

## Dialog Layout

The approval dialog has three rows of inline buttons:

| Row | Contents |
| --- | --- |
| 1 | Color buttons (first 3) |
| 2 | Color buttons (next 3) |
| 3 | Delegation toggle, Deny button |

## Color Button Order

Colors are ordered by usage — least recently used first. The top row contains the least-used colors (freshest picks), the bottom row the most-used. The exact ordering algorithm is owned by the session manager, not this dialog.

## Color Highlighting (Primary Style)

The `primary` style on a color button tells the operator: "this is the color the agent WILL get." It is a preview of the outcome.

- **Agent requests a color:** That color button gets `primary` style. Always. Regardless of whether the color is in use.
- **Agent does NOT request a color + delegation is ON:** The first color button (position 0 — the auto-assign candidate) gets `primary` style. This tells the operator what the governor will pick.
- **Agent does NOT request a color + delegation is OFF:** No button gets `primary` style. The operator is choosing manually — no prediction to show.

The highlighted color and the auto-approve outcome are always in sync. Whatever is highlighted IS what the agent gets if the governor approves.

## Deny Button

The deny button (`⛔ Deny`) uses `danger` style. Always present at the right side of the third row.

## Delegation Toggle

A toggle button on the third row, to the left of the deny button.

**States:**

- **ON:** `✅ Delegated` — governor auto-approval is enabled. The governor will approve incoming agents automatically using the highlighted color.
- **OFF:** `☐ Delegate` — governor auto-approval is disabled. Call to action: "click to delegate." The operator must manually pick a color.

**Behavior:**

- Default style (no `primary` or `danger` — just a normal button).
- Clicking the toggle changes the delegation config setting and refreshes the dialog (edits the message). The refreshed dialog reflects the new state — toggle text updates and color highlighting adjusts per the rules above.
- This is a message-edit toggle: click → update config → re-render the same message with updated buttons.
- The button count never changes. The only visual difference between states is the toggle text (`☐ Delegate` ↔ `✅ Delegated`).
- **The toggle does NOT approve the current pending agent.** It only changes the setting and refreshes the view. The operator still picks a color or denies manually for this agent.

## Governor Auto-Approve Flow

When delegation is ON and an agent connects:

1. The governor auto-approves with the highlighted color (the agent's requested color, or the first available if none requested).
2. No operator interaction needed.

When delegation is OFF:

1. The dialog appears and waits for the operator to pick a color or deny.
2. No button is pre-highlighted unless the agent requested a specific color.

## Race Conditions

If the governor resolves a pending agent (via `approve_agent` tool) while the approval dialog is still open, the dialog is deleted. The operator was too late — this is expected behavior. However, if the operator's callback arrives before the dialog is closed, it still processes normally.

## Reconnect Approval

When delegation is ON, reconnect requests from known sessions are auto-approved by the governor — same as new sessions. The operator does not need to manually approve reconnects when delegation is enabled.

## Rules

1. The `primary` style on a color button always means "this is the color the agent will get."
2. The `danger` style is reserved for the deny button.
3. The delegation toggle never auto-approves the current pending agent.
4. Button count in the dialog never changes — only toggle text and color highlighting change.
5. The `style` property on inline keyboard buttons is a real Telegram Bot API feature (9.3+). Never remove it.

## Open Questions

_(none — all resolved)_

## Bug Log

### BUG: Color style removed from approval buttons (2026-04-10)

- **What happened:** `style: "primary"` and `style: "danger"` were removed from buttons because they were mistakenly believed to be unsupported by Telegram Bot API.
- **Root cause:** `style` is a real Bot API 9.3 feature, already used throughout TMCP (`confirm.ts`, `choose.ts`, reconnect dialog). It is passed directly to the API via `as Record<string, unknown>`.
- **Spec update:** Added Rule 5.

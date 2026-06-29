---
id: 10-3079
created: 2026-06-29
status: draft
priority: 10
type: Bug
source: operator-observation-2026-06-29-msg82031
repo: electrified-cortex/Telegram-Bridge-MCP
---

# 10-3079 — Confirm/Question message renders with wrong formatting (small text, markdown-style)

## Observed

Operator tapped Deny on a `type:"question"` confirm prompt (msg 82029). After the interaction, the
message text appeared with small/styled formatting — "looked like markdown or HTML" — even though
the message text contained no markdown. Operator described it as "text was small, like as if it was
markdown or HTML."

Message sent: `"Request: change Overseer color from red to orange. Approve to apply, Deny to cancel."`

## Expected

Plain text message rendered at normal size with no markdown styling applied.

## Suspected cause

The bridge may be sending `confirm` / `question` type messages with `parse_mode: "Markdown"` (the
default for text sends), which causes Telegram to render the message with Markdown-parsing enabled.
Even without explicit markdown syntax, Markdown parse mode can cause subtle rendering differences
(e.g., italic/small text artifacts if any characters are misinterpreted, or a general styling
difference visible in some Telegram clients).

The `confirm` send type should use `parse_mode: "MarkdownV2"` with properly escaped text, OR use
`parse_mode: "HTML"` with plain text (no tags), OR explicitly pass `parse_mode: "Markdown"` with
no special characters. Investigate whether the confirm message bypasses the normal text-send parse
mode handling.

## Acceptance criteria

- AC-1: `type:"question"` / `confirm` messages render at normal text size with no markdown artifacts.
- AC-2: Operator cannot visually distinguish a confirm prompt message from a plain text message
  in terms of text size and style.
- AC-3: `cargo test` (or equivalent) passes with no regressions.

## Notes

- Observed during Feature 1 triage (deny button keyboard clear smoke test, 2026-06-29).
- The deny button itself WORKED correctly (keyboard cleared on Deny tap) — this is a formatting
  side-effect, not a functional regression.
- No markdown was in the message text. Operator said "there was no markdown in the message."

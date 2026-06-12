---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 10-427
Source: Dogfood test 10-404, rows 7 + 17
---

# MarkdownV2 rendering broken on edit and inconsistent on send

## Objective

Fix MarkdownV2 rendering across send and edit operations. Currently
`parse_mode: "MarkdownV2"` doesn't consistently render formatted text.

## Context

Dogfood findings:
- **Row 7 (send):** `*bold*` in MarkdownV2 mode didn't render visually on send.
  Note: Telegram MarkdownV2 uses single `*` for bold, not `**`. The server may
  need to document this or auto-convert.
- **Row 17 (edit):** Both `*bold*` and `_italic_` with MarkdownV2 parse_mode
  didn't render on `message/edit`.
- **Row 30 (cancel):** HTML parse_mode on animation cancel works correctly —
  so the issue is MarkdownV2-specific, not parse_mode in general.

Telegram MarkdownV2 requires escaping special characters outside format entities.
The server may need to auto-escape or clearly document the required format.

## Acceptance Criteria

- [ ] `send(text: "*bold*", parse_mode: "MarkdownV2")` renders bold text
- [ ] `action(type: "message/edit", text: "*bold*", parse_mode: "MarkdownV2")` renders bold
- [ ] Either auto-escape special chars or document MarkdownV2 syntax in help
- [ ] Test: send and edit with bold, italic, code, links in MarkdownV2

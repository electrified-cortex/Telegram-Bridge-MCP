# 10 — Unrenderable Character Warning

## Summary

Detect characters in outbound messages that Telegram cannot render
properly and warn the sending agent via service message.

## Context

Agents sometimes send characters (arrows, special Unicode) that
Telegram displays as missing glyphs or boxes. The sender has no
feedback that their message looks broken on the operator's end.

## Requirements

1. After a message is sent successfully, scan the text for characters
   known to fail in Telegram rendering
2. If unrenderable characters detected, deliver a service message to
   the sending session: "Message sent, but some characters may not
   render correctly in Telegram: [list chars]. Use ASCII alternatives."
3. Build/maintain a character blocklist (common offenders: certain
   arrows, box-drawing chars, obscure Unicode)
4. Optional: auto-replace known bad chars before sending (e.g.
   → becomes ->), with a service message noting the substitution

## Acceptance Criteria

- [x] Post-send character scan implemented
- [x] Service message delivered when bad chars detected (`unrenderable_chars_warning` event type)
- [x] Character blocklist is configurable/extendable (exported `UNRENDERABLE_RANGES` + `UNRENDERABLE_CHARS`)
- [x] All tests pass (47/47)

## Completion

**Completed:** 2026-04-17
**Branch:** `10-590-unrenderable-character-warning` (Telegram MCP)
**Commit:** `a7a3444`

**Changes:**
- `src/unrenderable-chars.ts` — exports `UNRENDERABLE_RANGES`, `UNRENDERABLE_CHARS`, and `findUnrenderableChars(text)`. Covers box-drawing, block elements, misc symbol/arrow ranges, plus specific codepoints: arrows (→←↔⇒⇐⇔), ellipsis (…), em/en dash (—–), curly quotes.
- `src/tools/send.ts` — after text chunks send successfully, scans original text and calls `deliverServiceMessage(_sid, ..., "unrenderable_chars_warning")` if bad chars found
- `src/unrenderable-chars.test.ts` — 13 unit tests

**Note:** Auto-replace (req 4) not implemented — left as optional per spec.

## Delegation

Worker task. Needs research on which characters Telegram fails to
render (may vary by client/platform).

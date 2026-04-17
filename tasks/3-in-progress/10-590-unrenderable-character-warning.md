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

- [ ] Post-send character scan implemented
- [ ] Service message delivered when bad chars detected
- [ ] Character blocklist is configurable/extendable
- [ ] All tests pass

## Delegation

Worker task. Needs research on which characters Telegram fails to
render (may vary by client/platform).

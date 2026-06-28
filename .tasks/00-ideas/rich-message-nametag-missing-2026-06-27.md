# Rich Message Nametag Missing

**Source:** Operator TG 80086, 2026-06-27
**Status:** idea — needs investigation + TMCP fix

## Problem

When a bot session sends a "rich message" (tables, heavy Markdown formatting, or document/file type), the session nametag prefix (e.g. `🟦 👨‍🏫 Curator`) is not visible to the operator. For standard text messages the nametag appears as the first line. For rich messages it gets lost.

## Operator verbatim

> "Okay so because you sent a rick message, I don't see your nametag. Needs a solution. But looks amazing!"

## Likely root causes

1. **Document/file sends**: When content is sent as `send(type:'file')`, the nametag is in the caption but the file icon/preview dominates the display — caption is visually de-emphasized.
2. **Very long messages** (>4096 chars): Telegram truncates with "Long message received." notification; the nametag is in the first block but subsequent blocks may drop it.
3. **Telegram's own rendering**: For messages with complex Markdown tables, Telegram may strip or reformat the opening line.

## Proposed fix

Ensure nametag is visible regardless of message type:
- For file/document sends: prepend nametag to caption AND embed it in the file content header
- For long messages: ensure all split chunks carry the nametag header
- For rich text: test whether Telegram strips the first line on table-heavy messages and if so send nametag as a separate preceding message

## Next step

Investigation → determine exact failure mode → fix in TMCP send path

## Links

- Related: `10-3018-v8-rich-messages-native-implementation.md` (V8 rich messages task)
- Blocking: operator UX — operator cannot identify message source on rich messages

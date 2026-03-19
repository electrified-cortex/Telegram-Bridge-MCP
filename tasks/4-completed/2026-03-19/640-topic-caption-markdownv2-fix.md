# 640 — Topic caption MarkdownV2 fix

## Problem

`send_text_as_voice` was generating topic captions using `**[Topic]**` (standard Markdown double-asterisk bold) but passing `parse_mode: "Markdown"` (Telegram legacy). Legacy Markdown uses single asterisks for bold (`*bold*`), so `**[Topic]**` rendered literally as `**[Topic]**` instead of bold **[Topic]**.

## Fix

- Import `markdownToV2` into `send_text_as_voice.ts`
- Convert topic+caption through `markdownToV2()` before sending
- Send with `parse_mode: "MarkdownV2"` instead of `"Markdown"`
- Updated test expectations to match MarkdownV2 output

## Status

Code changes complete. Tests pass (1504/1504). Awaiting commit approval.

## Files Changed

- `src/tools/send_text_as_voice.ts` — import `markdownToV2`, convert caption, use MarkdownV2 parse mode
- `src/tools/send_text_as_voice.test.ts` — updated topic formatting test expectations

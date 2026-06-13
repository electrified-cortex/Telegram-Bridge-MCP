# 041 — Warn agents when send_text contains markdown tables

**Type:** Enhancement
**Priority:** 20

## Problem

Agents frequently send Telegram messages containing markdown tables (e.g., `| Col1 | Col2 |`). Telegram does not render markdown tables — they appear as raw pipe-delimited text, which is hard to read.

## Proposal

When `send_text` detects a markdown table in the message body, include an advisory `info` field in the tool response, e.g.:

```json
{
  "message_id": 12345,
  "info": "Message sent. Note: markdown tables were detected but not formatted — Telegram does not support table rendering."
}
```

This is **not a failure** — the message is still sent. The info serves as a learning signal for agents to adjust their formatting strategy.

## Detection Heuristic

A simple regex for pipe-delimited table rows: a line matching `^\|.*\|$` (at least two pipe characters on a line, starts and ends with pipe). A separator row like `|---|---|` is a strong signal.

## Acceptance Criteria

- [x] `send_text` checks the message body for markdown table patterns
- [x] If detected, adds an `info` field to the response JSON with a descriptive warning
- [x] No change to message delivery — the message is still sent normally
- [x] Test coverage for the detection and warning

## Completion

**Files modified:**
- `src/tools/send_text.ts` — Added `TABLE_WARNING` constant, `containsMarkdownTable()` helper (regex `^\|.*\|$`), and conditional `info` field in both single and split response paths.
- `src/tools/send_text.test.ts` — Added `describe("markdown table detection")` block with 4 tests: no table → no info, table → info, message still sent, split messages with table include info.
- `changelog/unreleased.md` — Added `Added` entry for the new advisory warning.

**Results:**
- `pnpm build` — passed
- `pnpm test` — 1084 tests passed (40 test files)
- `pnpm lint` — no errors


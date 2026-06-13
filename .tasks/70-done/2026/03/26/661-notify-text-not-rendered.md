# 661: notify tool — text field content not rendered

| Field | Value |
| --- | --- |
| Priority | 10 (bug) |
| Status | Queued |
| Created | 2026-03-26 |
| Scope | Telegram MCP |

## Problem

The `notify` tool renders only the `title` field in Telegram. The `text` field content is missing from the rendered notification message.

## Reproduction

1. Call `notify` with both `title` and `text` parameters
2. Only the title appears in the Telegram chat
3. The text body is absent

## Expected

Both title and text should be visible in the notification message.

## Observed by

Operator and Worker during session 2026-03-26 (message 15908–15912).

## Completion

**Agent:** Worker
**Date:** 2026-03-26

### What Changed

- Updated `src/tools/notify.ts` to accept `text` as a deprecated alias for `body`.
- Kept `body` as the canonical field and preserved behavior priority: `body` wins when both are provided.
- Updated `docs/manual-test-walkthrough.md` example to use `notify(title, body, severity)`.
- Added regression tests in `src/tools/notify.test.ts` for alias support and precedence behavior.

### Test Results

- Ran: `pnpm vitest run src/tools/notify.test.ts`
- Result: 15 tests passing
- New coverage includes:
	- `text` alias renders body content when `body` is omitted
	- `body` takes precedence over `text` when both are supplied

### Findings

- Root cause was parameter mismatch: task/users called `notify` with `text`, while schema only accepted `body`.
- Handler rendered detail content only from `body`, so `text` input was dropped.

### Acceptance Criteria Status

- [x] Calling `notify` with `title` and `text` now shows both title and detail text.
- [x] Calling `notify` with canonical `body` remains unchanged.
- [x] Behavior is covered by automated tests.

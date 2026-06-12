# 665 — Auto-Reply on Checklist/Progress Completion

| Field    | Value          |
| -------- | -------------- |
| Created  | 2026-03-26     |
| Priority | low            |
| Scope    | Telegram MCP   |
| Stage    | 2-queued       |

## Context

When a checklist or progress bar completes (all steps terminal / 100%), the server
currently unpins the message. The operator wants a **completion reply** — a short
message sent as a reply to the completed checklist/progress, surfacing it in the
chat feed even if the original is scrolled off-screen.

## Requirements

1. **Checklist** (`update_checklist` in `src/tools/send_new_checklist.ts`):
   When all steps reach a terminal status (`done`/`failed`/`skipped`), after the
   existing `unpinChatMessage` call, send a reply:
   - `sendMessage(chatId, "✅ Complete", { reply_to_message_id: message_id })`
   - No `parse_mode` needed (plain text emoji + word)
   - Best-effort — `.catch(() => {})` like the unpin
   - **No session header** — use `_skipHeader: true` in the options object to
     tell the outbound proxy to skip nametag injection for this message

2. **Progress** (`update_progress` in `src/tools/update_progress.ts`):
   When `percent === 100`, after the existing `unpinChatMessage` call, send the
   same reply:
   - `sendMessage(chatId, "✅ Complete", { reply_to_message_id: message_id })`
   - Same rules: best-effort, no parse_mode, `_skipHeader: true`

3. **Outbound proxy** (`src/outbound-proxy.ts`):
   The `sendMessage` proxy already injects session headers. Add a check:
   if `(opts as Record<string, unknown>)?._skipHeader === true`, skip header
   injection entirely for that call. Strip `_skipHeader` from the options before
   passing to the real API (Telegram doesn't know about it).

4. **Tests**: Add/update tests:
   - Checklist: verify completion reply is sent with `reply_to_message_id`
   - Progress: verify completion reply is sent with `reply_to_message_id`
   - Outbound proxy: verify `_skipHeader` suppresses header injection
   - Verify reply is NOT sent when steps are not all terminal / percent < 100

## Implementation Notes

- The completion reply is a UX convenience for the operator, not agent-facing.
  The tool return value does NOT change.
- The reply message looks like a service message in the chat — no bold nametag,
  just "✅ Complete" as a reply link.
- `_skipHeader` is an internal convention (underscore prefix). It never reaches
  Telegram's API — strip it before the `fn(...args)` call.

## Acceptance Criteria

- [x] Completing a checklist sends a "✅ Complete" reply to the checklist message
- [x] Reaching 100% progress sends a "✅ Complete" reply to the progress message
- [x] Completion replies have no session nametag header
- [x] `_skipHeader` is stripped before reaching the real Telegram API
- [x] No reply sent for non-terminal/partial updates
- [x] All existing tests pass
- [x] New tests cover the completion reply and `_skipHeader` behaviors

## Completion

**Date:** 2026-03-26

### Files Changed

- `src/outbound-proxy.ts` — Added `_skipHeader` internal flag support in the
  `sendMessage` proxy. When `_skipHeader: true` is present in opts, skips header
  injection entirely. Strips `_skipHeader` before passing opts to the real API.

- `src/tools/send_new_checklist.ts` — In `update_checklist`, after
  `unpinChatMessage` in the `allTerminal` block, sends a best-effort
  `"✅ Complete"` reply with `reply_to_message_id` and `_skipHeader: true`.

- `src/tools/update_progress.ts` — In `update_progress`, after
  `unpinChatMessage` in the `percent === 100` block, sends the same best-effort
  reply.

- `src/outbound-proxy.test.ts` — Added two tests: verify `_skipHeader`
  suppresses header injection; verify `_skipHeader` is stripped before real API.

- `src/tools/send_new_checklist.test.ts` — Added `sendMessage` default mock in
  `beforeEach`; added two tests: completion reply sent when all terminal, not
  sent when partial.

- `src/tools/update_progress.test.ts` — Added `sendMessage` to mocks and
  `beforeEach`; added two tests: completion reply sent at 100%, not sent below.

- `changelog/unreleased.md` — Added changelog entry.

### Results

- Tests: **1757 passed** (94 test files)
- Build: **clean** (tsc + gen-build-info)
- Code review: pending (see below)


---
created: 2026-06-13
status: draft
priority: 10
source: Curator decomposition of epic 10-3001 (operator voice, 2026-06-11)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
epic: 10-3001-v8-rich-messages-markup
depends_on: ["10-3010", "10-3011"]
---

# 10-3012 — Rich Messages: Raw-Fetch Sender (`sendRichMessageDirect`)

## Context

Epic 10-3001 §3 specifies that grammY `^1.43.0` does not expose
`sendRichMessage` or `sendRichMessageDraft`. The established pattern for calling
Bot API endpoints that grammY doesn't support is the `sendVoiceDirect` function
in `src/telegram.ts` (~line 533): it reads `BOT_TOKEN` from `process.env`,
builds a request body, and calls the Bot API via native `fetch`.

This task implements the raw-fetch sender layer for rich messages, following
that exact pattern. It is a **self-contained, independently mergeable PR** —
no routing changes, no Markdown compiler, no change to any existing send path.

## Objective

Add three raw-fetch helper functions to `src/telegram.ts`, modelled on
`sendVoiceDirect`:

1. **`sendRichMessageDirect(chatId, richMessage, options)`**
   - Calls `sendRichMessage` Bot API endpoint via native `fetch`.
   - `richMessage: InputRichMessage` — typed from `src/types/rich-message.ts`
     (produced by task 10-3011).
   - `options`: `disable_notification?`, `reply_to_message_id?`,
     `message_thread_id?`, `business_connection_id?`.
   - Returns `{ message_id: number }`.
   - Maps API error responses to the existing `TelegramError` type.
   - Adds a new error code `RICH_MESSAGE_UNSUPPORTED` for the case where the
     Bot API returns a 10.1-unavailable error (exact error code to be confirmed
     from schema doc 10-3011).

2. **`updateRichMessageDraftDirect(chatId, draftId, richMessage, options)`**
   - Calls the draft-update endpoint (name to be confirmed from 10-3011 schema).
   - Stub implementation acceptable if the draft API shape is not yet confirmed;
     stub must throw `new Error("not yet implemented")` and be marked with a
     `TODO(10-3012)` comment.

3. **`finalizeRichMessageDraftDirect(chatId, draftId, options)`**
   - Calls the draft-finalize endpoint (name to be confirmed from 10-3011).
   - Same stub policy as above.

## Scope

**Modifies:**
- `src/telegram.ts` — adds three functions; no existing function modified.

**Does not modify:**
- `src/markdown.ts` — zero changes.
- `src/tools/send.ts` or any send sub-handler — zero changes.
- `src/outbound-proxy.ts` — zero changes.
- Routing logic — zero changes. No message is routed through the new functions
  by default. They are callable only from tests or an explicit future routing
  task (10-3016).

## Acceptance Criteria

- [ ] `sendRichMessageDirect` is implemented and exported from `src/telegram.ts`.
- [ ] `sendRichMessageDirect` reads `BOT_TOKEN` from `process.env`, never from
      a hardcoded or imported constant.
- [ ] `sendRichMessageDirect` maps a 10.1-unavailable API error to
      `RICH_MESSAGE_UNSUPPORTED` in the `TelegramError` error code enum.
- [ ] Unit tests in `src/telegram.test.ts` cover (additive — no existing test
      modified):
      - Successful call returns `{ message_id }`.
      - Non-2xx HTTP response throws `TelegramError`.
      - `RICH_MESSAGE_UNSUPPORTED` error code is set on the appropriate API error.
- [ ] `pnpm test` passes with all pre-existing tests green.
- [ ] `tsc --noEmit` passes (no TypeScript errors introduced).
- [ ] **Non-regression gate:** the 10-3010 snapshot suite passes unchanged,
      confirming zero impact on current message rendering paths.
- [ ] No call site in `src/tools/` calls the new functions (verified by
      `grep -r sendRichMessageDirect src/tools/` returning no results).

## Delegation

Executor: Worker / Reviewer: Curator

## Notes

- Model on `sendVoiceDirect` (src/telegram.ts ~line 533): same `fetch` pattern,
  same error-mapping pattern, same `BOT_TOKEN` read pattern.
- The `InputRichMessage` type import comes from `src/types/rich-message.ts`
  (task 10-3011). Do not define any new rich-message types inline in
  `src/telegram.ts`.
- If the draft API shape is unconfirmed when this task executes, ship stub
  implementations for the two draft functions and note them in the PR description.
  The stubs do not block merging.
- `RICH_MESSAGE_UNSUPPORTED` should be added to the existing error-code union
  in `src/telegram.ts` without renaming or reordering existing codes.

## Overseer review

**Reviewer**: Overseer
**Date**: 2026-06-13
**Verdict**: PASS
**Review type**: Adversarial (single dispatch — Curator-authored spec, operator-greenlighted)
**Checked**: Binary ACs, scope (single file, 3 functions, additive), sendVoiceDirect pattern reference, stub policy for draft API, non-regression gate, delegation
**Not checked**: Draft API field names (deferred to 10-3011 schema doc per spec)

## Verification

**Verifier**: Dispatch agent (task-verification skill)
**Date**: 2026-06-13
**Verdict**: APPROVED

All 8 acceptance criteria confirmed:
- AC1: `sendRichMessageDirect` exported from `src/telegram.ts` (line 648)
- AC2: `BOT_TOKEN` read from `process.env` (line 658) — never hardcoded
- AC3: `RICH_MESSAGE_UNSUPPORTED` added to `TelegramErrorCode` union (line 109); error mapping at lines 690–693
- AC4: 4 unit tests in new `describe("sendRichMessageDirect")` block — success, non-2xx, `RICH_MESSAGE_UNSUPPORTED`, missing token
- AC5: `pnpm test` green — 148 test files, 3498 tests all passed
- AC6: `tsc --noEmit` — exit 0, 0 errors
- AC7: Non-regression — 10-3010 snapshot suite passes unchanged (all 3498 tests include snapshot suite)
- AC8: `grep -r sendRichMessageDirect src/tools/` — no results

**Squash commit**: `65fedaf` (dev)
**Sealed-By**: Foreman

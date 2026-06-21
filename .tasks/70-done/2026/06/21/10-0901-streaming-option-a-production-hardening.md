---
id: "10-0901"
title: "Option A streaming — production hardening (rate limit guard, stream timeout, overflow guard, agent guide)"
type: feature
priority: 10
status: review
created: 2026-05-14
filed-by: Foreman (follow-on from spike 10-0889)
delegation: Worker
target_repo: telegram-bridge-mcp
target_branch: dev
depends_on: ["10-0889"]
---

# Option A streaming — production hardening

## Background

Spike task 10-0889 prototyped MCP-native deliberate streaming (Option A: `stream/start` → `stream/chunk` → `stream/flush`) and confirmed it is feasible. The prototype is in `src/tools/send/stream.ts` with 11 tests, merged to `dev` on branch `feat/10-0889-streaming-spike`.

Real LLM token streaming is NOT possible (confirmed by 10-0889 and prior spike 10-560). This task implements the production-ready version of Option A.

Reference: `docs/spikes/10-0889-streaming-findings.md`

## Gaps to address (from spike findings)

1. **Rate limit guard** — `stream/chunk` should return `{ code: "RATE_LIMITED" }` instead of letting Telegram 429s propagate as unhandled errors.

2. **Stream timeout** — active streams should expire after N minutes (configurable) to prevent memory leak if an agent never calls `stream/flush`.

3. **Message overflow guard** — accumulated text can hit Telegram's 4096-character message limit. `stream/chunk` should detect overflow and return a structured error rather than silently truncating or throwing.

4. **Agent guide** — document the deliberate chunking pattern in `docs/help/` so agents know: when to use streaming, how to generate incrementally, and the token cost tradeoff (~2.5x vs. buffered send).

## Acceptance criteria

- [ ] `stream/chunk` returns `{ code: "RATE_LIMITED", retryAfterMs }` on 429 instead of propagating exception.
- [ ] Active streams expire after configurable timeout (default: 10 min); expired stream returns `{ code: "STREAM_EXPIRED" }` on subsequent chunk/flush.
- [ ] `stream/chunk` returns `{ code: "STREAM_OVERFLOW", currentLength, maxLength }` if accumulated text would exceed 4096 chars.
- [ ] `docs/help/streaming.md` created with: when to use, deliberate chunking pattern, token cost warning, example agent flow.
- [ ] `help('streaming')` is routable via `src/tools/help.ts`.
- [ ] All new error codes tested (unit tests).
- [ ] Existing 11 stream tests remain passing; new tests are additive.

## Dispatch

Worker. Sonnet for implementation and docs; Haiku for test fixtures.

## Bailout

3 hours. If Telegram rate limit semantics are unclear from API docs, surface to Curator before designing the guard.

## Notes

- Rate limit ceiling: ~1 edit/sec per message sustained; ~20/sec burst. TMCP enforces `MIN_SEND_INTERVAL_MS = 1000`. See findings doc lines 59-62.
- Token cost: ~2.5x vs. buffered send for a 1000-token/10-chunk example. Agent guide must document this.
- v7.5 target per operator priority (msgs 51226, 51234, 2026-05-07).

## Worker summary

**Implemented by:** worker/10-0901-streaming-option-a-production-hardening  
**Commit:** 2e79a698  
**Date:** 2026-06-21

### What was implemented

1. **Rate limit guard** — `handleStreamChunk` catches `GrammyError` with `error_code === 429` and returns `{ code: "RATE_LIMITED", retryAfterMs: <n> }`. Uses `err.parameters.retry_after ?? 5` (seconds), converted to ms. Existing error path (non-429) unchanged.

2. **Stream timeout** — Added `createdAt: number` to `StreamEntry`. `STREAM_TIMEOUT_MS` constant reads from `process.env.STREAM_TIMEOUT_MS` with default of 600 000 ms (10 min). `isExpired()` helper checks on every `chunk` and `flush`. Expired streams are deleted and return `{ code: "STREAM_EXPIRED" }`.

3. **Message overflow guard** — After computing `accumulated`, length is checked against `TELEGRAM_MESSAGE_LIMIT = 4096` before calling `editMessageText`. Returns `{ code: "STREAM_OVERFLOW", currentLength, maxLength: 4096 }`. The Telegram API is never called when overflow would occur.

4. **Error codes** — `STREAM_EXPIRED` and `STREAM_OVERFLOW` added to `TelegramErrorCode` union in `src/telegram.ts`.

5. **Agent guide** — `docs/help/streaming.md` created covering: when to stream vs. buffer, deliberate chunking pattern, token cost table (~2.5× for 1 000-token/10-chunk example), example agent flow, error code table, limits & constraints.

6. **Help routing** — `"streaming"` added to `RICH_TOPICS` set in `src/tools/help.ts`. `help("streaming")` now serves the file-based doc.

### Test results

- Original 11 stream tests: all passing ✓
- New tests added: 7
  - `RATE_LIMITED` with `retry_after` present (30s → 30 000ms)
  - `RATE_LIMITED` without `retry_after` (default 5s → 5 000ms)
  - `STREAM_OVERFLOW` when accumulated exceeds 4096
  - `STREAM_OVERFLOW` at exactly 4097 chars
  - No overflow at exactly 4096 chars
  - `STREAM_EXPIRED` on chunk after timeout
  - `STREAM_EXPIRED` on flush after timeout
- Total stream tests: 18 (11 original + 7 new)
- Full suite: 3558 passing, 2 pre-existing failures in `service-messages.test.ts` (unrelated to this task — those tests check for `max_wait: 0/30` in onboarding text and were failing before this branch)

### Deviations from spec

None. All acceptance criteria met.

## Verification

**Verifier:** Dispatch agent (independent)  
**Date:** 2026-06-21  
**Verdict:** APPROVED

All 7 acceptance criteria CONFIRMED with citation:
1. CONFIRMED — `stream.ts:128-137`: 429 guard returns `{ code: "RATE_LIMITED", retryAfterMs }` (tests lines 162-213)
2. CONFIRMED — `stream.ts:16-23,37-40,65,92-96,156-160`: configurable timeout, `isExpired()`, STREAM_EXPIRED on chunk/flush (tests lines 264-327)
3. CONFIRMED — `stream.ts:9,109-117`: 4096-char overflow guard returns `{ code: "STREAM_OVERFLOW", currentLength, maxLength }` without calling API (tests lines 215-260)
4. CONFIRMED — `docs/help/streaming.md`: 116-line doc with when-to-use table, chunking pattern, token cost warning, example flow, error code table
5. CONFIRMED — `help.ts`: `"streaming"` added to `RICH_TOPICS` set
6. CONFIRMED — `stream.test.ts`: 7 new tests covering RATE_LIMITED (×2), STREAM_OVERFLOW (×3), STREAM_EXPIRED (×2)
7. CONFIRMED — 3558 tests pass; 2 pre-existing `service-messages.test.ts` failures excluded (ONBOARDING_LOOP_PATTERN — unrelated to this task)

Sealed-By: Foreman (fix/flush-pending-channel-notify-timeout)

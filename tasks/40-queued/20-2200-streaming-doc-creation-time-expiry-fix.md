# Fix: streaming.md and stream.ts say "inactivity" but timeout is creation-time

**Priority:** 20
**Source:** Backlog audit 2026-06-22
**Repo:** electrified-cortex/Telegram-Bridge-MCP

## Problem

`docs/help/streaming.md:104` states:
> "Streams expire after 10 minutes of **inactivity** by default"

This is factually wrong. The implementation in `src/tools/send/stream.ts` expires streams based on **creation time** — `Date.now() - entry.createdAt > STREAM_TIMEOUT_MS` — not based on when the last chunk was sent. The comment at `stream.ts:12-13` also says "Inactivity / abandonment timeout."

A user reading the docs would expect that actively sending chunks resets the timer. It does not.

## Scope

Two files, surgical edits only:

1. `src/tools/send/stream.ts` — lines 12-13: change comment from "Inactivity / abandonment timeout" to "Creation-time timeout (stream expires N ms after stream/start, regardless of activity)"
2. `docs/help/streaming.md` — line 104: change "10 minutes of inactivity" to "10 minutes of creation time" (or equivalent clear phrasing)

No logic changes. Docs/comments only.

## Acceptance Criteria

- AC1: `docs/help/streaming.md` no longer contains the word "inactivity" in the expiry description.
- AC2: `src/tools/send/stream.ts` comment at the timeout constant accurately describes creation-time expiry.
- AC3: No other references to "inactivity" appear in stream-related files that conflict with the actual implementation (`grep -r inactivity src/tools/send/` returns no matches in expiry context).
- AC4: Build passes (`pnpm build` exits 0). No test changes needed (behavior unchanged).

## Delegation

- **Executor:** TMCP foreman → worker
- **Repo:** electrified-cortex/Telegram-Bridge-MCP
- **Files:** `src/tools/send/stream.ts`, `docs/help/streaming.md`

## Overseer stamp

**Reviewer:** Overseer | **Date:** 2026-06-22 | **Verdict:** PASS ✅
ACs binary + testable, scope bounded (2 files, comments/docs only), delegation correct, no open questions.

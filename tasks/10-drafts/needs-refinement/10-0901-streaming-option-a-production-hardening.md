---
id: "10-0901"
title: "Option A streaming — production hardening (rate limit guard, stream timeout, overflow guard, agent guide)"
type: feature
priority: 10
status: draft
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

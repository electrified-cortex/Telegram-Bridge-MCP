# 10-586 — Streaming Output via Append Mode

**Priority:** 10 (high)
**Created:** 2026-04-17
**Reporter:** Curator (operator-confirmed, demo successful)

## Problem

Agent responses appear as complete blocks after a silence period. The operator wants real-time streaming — text appearing progressively as the LLM generates it.

## Research Findings

- Claude Code CLI supports streaming in headless mode via `includePartialMessages` flag (Agent SDK)
- Each `text_delta` event carries incremental text over stdio JSON-lines transport
- TMCP already has `append` mode (`send(type: "append")`) which edits a message by adding text
- Telegram Bot API 9.5 added `sendMessageDraft` for native streaming (private chats only)
- Demo confirmed: append mode works end-to-end — just needs wiring to the stream

## Bugs Found During Demo

- Double name-tag prepend on append messages — needs investigation

## Testing Requirement

**Strong unit testing is mandatory.** Every component — coalescing queue, rate limiter, append dispatch, markdown handling — must have thorough test coverage before merge.

## Architecture

```
Claude Code (includePartialMessages) → text_delta events → TMCP bridge → coalescing queue → append_text to Telegram message
```

**Coalescing queue pattern:** Buffer incoming text_deltas, merge while rate-limited (~1/sec for edits). When rate window opens, flush accumulated batch as one edit. Three deltas in 0.9s = one edit call, not three.

**Two approaches:**
1. **Append mode (available now):** Buffer text_deltas, call `editMessageText` at ~1/sec cadence. Works in all chats. Shows "edited" indicator.
2. **sendMessageDraft (Bot API 9.5):** Native streaming bubble, no edit indicator. Private chats only. Requires Telegram Bot API update.

## Implementation Plan

### Phase 1: Append-based streaming
- [ ] Wire `includePartialMessages` into Claude Code subprocess launch
- [ ] Buffer `text_delta` events in TMCP bridge
- [ ] Emit append calls at throttled cadence (~1/sec to respect rate limits)
- [ ] Handle markdown formatting mid-stream (use plain text until final message)
- [ ] Final message replaces with fully formatted version

### Phase 2: Native streaming (sendMessageDraft)
- [ ] Evaluate Bot API 9.5 support in current Telegram library
- [ ] Implement sendMessageDraft path for private chats
- [ ] Fallback to Phase 1 for group contexts

### Also Fix
- [ ] Double name-tag bug in append mode

## Constraints

- Extended thinking mode and structured output are incompatible with `includePartialMessages`
- 5-minute stream abort timeout in Claude Code (auto-falls back to non-streaming)
- Rate limit: ~30 edits/sec global, ~1/sec practical for single chat

## Activity Log

- **2026-04-17** — Pipeline started. Variant: Design + Implement.
- **2026-04-17** — [Stage 2] Feature Designer dispatched. Design received (7 sections). Key finding: TMCP has no subprocess integration; `includePartialMessages` is external-agent responsibility. Coalescing queue belongs at agent layer, not TMCP.
- **2026-04-17** — [Stage 3] Design reviewed. Clean — all seven sections present, acceptance criteria verifiable, no implementation code, all 4 OQs non-blocking.
- **2026-04-17** — [Stage 4] Task Runner dispatched. 13 files changed (4 new: `stream_init.ts`, `stream_finalize.ts`, + test files). Commit: b7a280b.
- **2026-04-17** — [Stage 5] Verification: diff non-empty (564 insertions), 2379 tests passed.
- **2026-04-17** — [Stage 6] Code Reviewer iteration 1: 0 critical, 3 major (send.test.ts missing stream dispatch test; _rawText not asserted; parse_mode branch uncovered), 4 minor, 3 info. Fixes dispatched.
- **2026-04-17** — [Stage 6] Code Reviewer iteration 2: prior majors resolved; 1 new major (send.ts stream dispatch dropped parse_mode). Fix dispatched.
- **2026-04-17** — [Stage 6] Code Reviewer iteration 3: clean — 0 critical, 0 major. Minor/Info only (cosmetic schema description).
- **2026-04-17** — [Stage 7] Complete. Branch: 10-586, commit: b7a280b. Ready for Overseer review.

## Completion

Phase 1 TMCP-side streaming infrastructure implemented:

- **Double name-tag bug fixed** — `outbound-proxy.ts` now records pre-header raw agent text in message-store; the proxy remains the single header-injection layer. Subsequent appends no longer accumulate duplicate session headers.
- **`parse_mode: "none"` added** — `resolveParseMode` and `append_text` accept `"none"` mode, returning unescaped text with `parse_mode: undefined`. Enables safe plain-text delta appends mid-stream.
- **`send(type: "stream")` added** — New `stream_init.ts` sends a placeholder message and returns `message_id` for the agent to target with subsequent append calls. Forwards `placeholder` and `parse_mode`.
- **`stream_finalize` tool added** — Replaces accumulated draft with the final formatted text (replace semantics, not append). Records raw agent text in store.
- **Coalescing queue** is the external agent's responsibility (not TMCP); TMCP's `debounceSend` provides the 1 req/sec hard floor.

Subagent passes: Feature Designer ×1, Task Runner ×3, Code Reviewer ×3.
Final review: 0 critical, 0 major, 4 minor (cosmetic/edge-case), 3 info.
Minor findings noted: multi-chunk send records formatted text (pre-existing), `parse_mode:"none"` unreachable via `send(type:"append")` schema (undocumented gap), `objectContaining({parse_mode:undefined})` assertion slightly weak.

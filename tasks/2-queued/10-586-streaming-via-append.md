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

## Architecture

```text
Claude Code (includePartialMessages) → text_delta events → TMCP bridge → append_text to Telegram message
```

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

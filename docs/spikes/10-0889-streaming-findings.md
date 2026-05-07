# Spike Findings: Streaming Text Output from Agents to Telegram

**Task:** 10-0889
**Date:** 2026-05-07
**Branch:** `feat/10-0889-streaming-spike`
**Commit:** `908bd327`

## Verdict

**Real LLM token streaming is NOT possible with Claude Code + MCP architecture.**

Claude Code's token generation happens inside the VS Code extension process (Anthropic SDK). By the time an MCP tool call fires, the agent has already received the complete response. No hook, protocol extension, or proxy route allows an MCP server to intercept tokens mid-generation.

**Agent-deliberate streaming (Option A) IS feasible.** It requires agents to explicitly generate chunks and emit them via tool calls — not automatic streaming from the LLM.

## Prior Research

Task 10-560 (April 2026) conclusively ruled out all automatic streaming mechanisms:

| Approach | Status |
| --- | --- |
| Claude Code hooks (PreToolUse, PostToolUse, Notification, Stop) | Ruled out — no hook fires during token generation |
| MCP `notifications/message` | Not applicable — server-push only, no token capture |
| `--output-format stream-json` CLI flag | No such flag exists |
| MCP transport layer interception | Impossible — transport sees complete tool results |

## Option A: MCP-Native Stream Types (Prototyped)

### Protocol

```
send(type: "stream/start", text?: string)
  → { message_id, stream_id }

send(type: "stream/chunk", stream_id, text, separator?)
  → { message_id, length }

send(type: "stream/chunk", stream_id, text)
  ...repeat...

send(type: "stream/flush", stream_id)
  → { message_id, final_length, status: "flushed" }
```

### Implementation

- `src/tools/send/stream.ts` — new module with in-memory `Map<stream_id, { messageId, sid }>`
- State: accumulated text tracked in `message-store.ts` via `recordOutgoingEdit`
- `stream/start`: `sendMessage` + `recordOutgoing` + allocate UUID stream_id
- `stream/chunk`: `getMessage(CURRENT)` + append + `editMessageText` + `recordOutgoingEdit`
- `stream/flush`: delete stream entry, return final state (no edit — message already correct)

### Test coverage

11 tests across 3 describe blocks — all passing.

### Rate limit ceiling

- Telegram allows ~1 `editMessageText` per second per message (sustained)
- Burst: ~20/sec, but TMCP enforces `MIN_SEND_INTERVAL_MS = 1000`
- Practical: ~1 visible chunk per second
- 3 streaming agents simultaneously: ~0.33 chunks/sec each (global bot rate limit)

### Token cost

Streaming a 1000-token response in 10 chunks costs ~2.5x more tokens than a single send:
- 1000 tokens (generation) + ~1500 tokens (10x tool call overhead)
- vs. 1000 + ~150 tokens (1x tool call) for complete send

### UX

- Text appears in ~1-second intervals — noticeable but not continuous
- Good for: code reviews, audit summaries, long analysis output
- Not suitable for: live metrics, transcription, high-frequency updates

## Option B: HTTP Streaming Endpoint (Deferred)

HTTP-based streaming (POST chunks to `/stream/:token`) would have the same Telegram rate limit ceiling (~1 edit/second) as Option A. Higher implementation complexity (~2x), no UX improvement. Recommended: defer unless agents need to avoid MCP tool call overhead.

## Recommendation

Implement Option A as the production feature for v7.5. Key gaps to address before v7.5:

1. **Rate limit guard**: stream/chunk should return `{ code: "RATE_LIMITED" }` instead of letting 429s propagate
2. **Stream timeout**: active streams should expire after N minutes to prevent memory leak
3. **Agent guide**: document deliberate chunking pattern in `docs/help/` (agents must generate incrementally — not automatic)
4. **Markdown safety**: accumulated text can hit Telegram's 4096 char limit — `stream/chunk` should guard this

## Follow-on Tasks

- `feat(10-0889): Option A production implementation` — rate limiting, timeout cleanup, message overflow guard
- `docs(10-0889): agent streaming guide` — when/how to use stream types, token cost warning

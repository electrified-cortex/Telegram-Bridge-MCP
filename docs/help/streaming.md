# Streaming Guide

Streaming lets you push incremental output to a Telegram message as you generate it —
useful for long responses where you want the user to see progress rather than wait for
a single send at the end.

> **Important:** This is *deliberate* (agent-driven) streaming. You call the chunk tools
> explicitly. LLM token streaming is not available — see below for details.

---

## When to use streaming vs. buffered send

| Use streaming | Use `send` (buffered) |
|---|---|
| Long analysis, audit summaries, code reviews | Short responses (< 200 words) |
| You want the user to see incremental progress | Output is complete before you start |
| Output naturally comes in chunks (sections, steps) | Single send is cleaner UX |
| High-latency generation where silence feels broken | Token budget is tight |

Streaming costs ~2.5× more tokens than a single `send` for the same content — see the
Token Cost section below before choosing it.

---

## The deliberate chunking pattern

You must **generate text in chunks yourself** and emit each chunk via `stream/chunk`.
The LLM has already generated its full response by the time any tool call fires — there
is no automatic token-level streaming. A typical pattern:

```
1. Plan your output in sections (intro, body, conclusion, etc.)
2. stream/start → get stream_id
3. For each section you generate:
   a. Generate the section text
   b. stream/chunk with the section text
4. stream/flush → close the stream
```

This works because Telegram shows live edits — each chunk replaces the message text
instantly, giving a "streaming" appearance.

---

## Token cost warning

For a 1 000-token response sent in 10 chunks:

| Approach | Generation tokens | Tool overhead | Total |
|---|---|---|---|
| `send` (buffered) | ~1 000 | ~150 (1 tool call) | ~1 150 |
| Streaming (10 chunks) | ~1 000 | ~1 500 (10 tool calls × 150) | ~2 500 |

**~2.5× more tokens for streaming.** Choose streaming only when the UX benefit
(incremental progress) justifies the cost.

---

## Example agent flow

```
// 1. Open the stream (optional initial placeholder text)
result = stream/start(text: "⏳ Analyzing…")
stream_id = result.stream_id

// 2. Generate section 1, emit it
section1 = <generate intro paragraph>
stream/chunk(stream_id, text: section1)

// 3. Generate section 2, append with a blank-line separator
section2 = <generate body>
stream/chunk(stream_id, text: section2, separator: "\n\n")

// 4. Generate section 3, append
section3 = <generate conclusion>
stream/chunk(stream_id, text: section3, separator: "\n\n")

// 5. Close the stream
stream/flush(stream_id)
```

---

## Error codes

| Code | Meaning | What to do |
|---|---|---|
| `RATE_LIMITED` | Telegram 429 — too many edits | Wait `retryAfterMs` ms, then retry the chunk |
| `STREAM_EXPIRED` | Stream timed out (default 10 min) | Open a new stream with `stream/start` |
| `STREAM_OVERFLOW` | Accumulated text > 4 096 chars | Flush the stream and open a new one for the remainder |
| `STREAM_NOT_FOUND` | Unknown or already-flushed stream_id | Check that you have the right stream_id; open a new stream |
| `STREAM_FORBIDDEN` | stream_id belongs to a different session | Use the stream_id returned by your own `stream/start` call |

---

## Limits and constraints

- **Telegram character limit:** 4 096 chars per message. `stream/chunk` returns
  `STREAM_OVERFLOW` before hitting the API — flush and start a new stream for the
  remainder.
- **Rate limit:** ~1 edit/second per message (Telegram enforces this). The bridge
  surfaces `RATE_LIMITED` with `retryAfterMs` instead of throwing.
- **Stream timeout:** Streams expire after 10 minutes of inactivity by default.
  Override with the `STREAM_TIMEOUT_MS` environment variable (milliseconds).
- **Concurrent streams:** Multiple streams can be open simultaneously across sessions,
  but the global bot rate limit (~20 edits/sec burst, ~1/sec sustained) is shared.
  Three simultaneous streaming agents get ~0.33 chunks/sec each.

---

## Related tools

- `help('send')` — buffered send (text, audio, or both)
- `help('append_text')` — append text to an existing message (no stream state needed)
- `help('animation')` — looping frame animation (for progress indicators, not incremental text)

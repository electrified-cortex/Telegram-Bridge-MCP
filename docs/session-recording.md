# Session History

The server maintains an **always-on, in-memory message store** (`message-store.ts`) that records every inbound and outbound event automatically from the moment the server starts. There is nothing to enable or disable — recording is always active.

The store holds a rolling timeline of up to 1000 events and a random-access index of the last 500 messages by ID. Both are evicted in insertion order when capacity is exceeded.

---

## What is captured

- Inbound user messages (text, voice pre-transcribed, photos, documents, locations, contacts)
- Outbound bot messages (every tool send)
- Callback queries (inline button presses)
- Message reactions
- Edit history for bot messages

---

## Tools

### `dump_session_record`

Returns the full conversation timeline as compact JSON.

```text
dump_session_record(limit?: number)
```

| Parameter | Default | Max | Description |
| --- | --- | --- | --- |
| `limit` | 100 | 1000 | Most-recent events to include |

Returns: compact JSON with a `summary` object (event counts, store size) and a `timeline` array.

**When to call:** Only when the operator explicitly requests session history, context recovery, or an audit. This tool dumps full conversation content including voice transcripts, file metadata, and contacts — do not call speculatively.

---

### `get_message`

Look up a single stored message by ID with optional version history.

```text
get_message(message_id: number, version?: number)
```

| Parameter | Default | Description |
| --- | --- | --- |
| `message_id` | required | The message ID to look up |
| `version` | -1 (latest) | -1 = current; 0 = original; 1+ = edit number |

Returns: message text/caption, file metadata, reply context, and for bot messages, the full edit history.

**When to call:** Only for message IDs already seen in this agent session (received via `dequeue_update` or sent by the agent). Do not probe arbitrary IDs.

---

## Context recovery

If your context compacts mid-session and you lose track of what the user was working on:

```text
1. dump_session_record(limit: 20)   — review the 20 most recent events
2. Resume from where you left off
```

---

## Notes

- The store is **in-memory only** — content is not written to disk and is lost when the server restarts.
- Voice messages arrive pre-transcribed in the timeline (background poller handles transcription).
- `dump_session_record` returns sensitive personal content. Follow the PII guidance in `security-model.md`.

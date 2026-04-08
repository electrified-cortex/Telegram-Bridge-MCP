# Session Log

The server records every inbound and outbound event in an **always-on, in-memory message store** from the moment it starts. There is nothing to enable — recording is always active, and events are available instantly for tools and the `/session` command.

## Architecture

```text
┌──────────────┐     recordInbound()     ┌──────────────────┐
│  Poller      │ ───────────────────────► │   Message Store   │
│  (getUpdates)│                          │   (message-store) │
└──────────────┘                          │                   │
                                          │  timeline  [1000] │
┌──────────────┐     recordOutgoing()     │  index      [500] │
│  Outbound    │ ───────────────────────► │  queue      (∞)   │
│  Proxy       │                          └─────────┬─────────┘
└──────────────┘                                    │
                                          dumpTimeline()
                                          dumpTimelineSince()
                                                    │
                           ┌────────────────────────┼──────────────┐
                           ▼                        ▼              ▼
                   dump_session_record      /session panel    auto-dump
                   (MCP tool)               (built-in cmd)    (threshold)
                           │                        │              │
                           ▼                        ▼              ▼
                   JSON file sent to Telegram ──────────────────────
                   caption includes file_id for crash recovery
```

**Rolling storage:**

- **Timeline** — up to 1000 events, evicted oldest-first.
- **Index** — last 500 messages by ID, with full edit history.
- **Queue** — inbound events waiting for `dequeue`.

All data is in-memory only and lost on server restart.

## What is captured

| Direction | Events |
| --- | --- |
| Inbound | Text messages, voice (pre-transcribed), photos, documents, locations, contacts |
| Outbound | Every bot message sent via the outbound proxy (text, files, edits) |
| Metadata | Callback queries, message reactions, file IDs for all file sends |

Voice messages arrive in the timeline already transcribed — the background poller handles transcription before storing.

## Dumping the session log

There are three ways to dump the timeline as a downloadable JSON file in Telegram:

### 1. `dump_session_record` tool (agent-initiated)

```text
dump_session_record(limit?: number)
```

| Parameter | Default | Max | Description |
| --- | --- | --- | --- |
| `limit` | 100 | 1000 | Most-recent events to include |

The tool sends a JSON document to the Telegram chat and returns:

```json
{ "message_id": 7581, "event_count": 42, "file_id": "BQACAgEA..." }
```

The agent can later download the file using `download_file` with the returned `file_id`.

**When to call:** Only when the operator explicitly requests session history, context recovery, or an audit. This tool dumps full conversation content including voice transcripts, file metadata, and contacts — do not call speculatively.

### 2. `/session` command (user-initiated)

The user types `/session` in Telegram to open a panel:

```text
📊 Session Log
Timeline: 42 events · 38 messages

[Dump JSON]  [Auto-dump ✗]  [Dismiss]
```

- **Dump JSON** — sends a full timeline dump as a JSON file.
- **Auto-dump** — toggles periodic automatic dumps (fires every N events). Configurable at startup or via the panel.
- **Dismiss** — closes the panel.

### 3. Auto-dump (threshold-based)

When enabled, the server automatically dumps an incremental log every N events. The threshold is set during the startup preferences prompt or toggled via `/session → Auto-dump`. Incremental dumps only include events since the last dump, reducing file size.

## File ID in caption

Every session log document has its Telegram `file_id` appended to the caption in monospace:

```text
📼 Session log · 42 events
File ID: `BQACAgEAAxkDAAIdnWm1hxs7...`
```

This exists for **crash recovery**: if the server restarts and in-memory state is lost, the user can copy the file ID from the caption and paste it to the new agent instance. The agent can then call `download_file` with that ID to retrieve the full session log and restore context.

## `get_message` — single message lookup

```text
get_message(message_id: number, version?: number)
```

| Parameter | Default | Description |
| --- | --- | --- |
| `message_id` | required | The message ID to look up |
| `version` | -1 (latest) | -1 = current; 0 = original; 1+ = edit number |

Returns message text/caption, file metadata, reply context, and for bot messages the full edit history.

**When to call:** Only for message IDs already seen in this agent session (received via `dequeue` or sent by the agent). Do not probe arbitrary IDs.

## Context recovery

If context compacts mid-session:

1. Call `dump_session_record(limit: 20)` to review the most recent events.
2. The JSON file arrives in Telegram — download it via the returned `file_id`.
3. Resume from where you left off.

If the server restarted and the timeline is empty, look for the most recent session log document in the chat. Copy the `file_id` from its caption and call `download_file` to retrieve the previous session's history.

## JSON format

```json
{
  "generated": "2026-03-14T16:04:37Z",
  "timeline_events": 42,
  "unique_messages": 38,
  "returned": 42,
  "truncated": false,
  "timeline": [
    {
      "id": 1,
      "timestamp": "2026-03-14T15:30:00Z",
      "event": "message",
      "from": "user",
      "content": { "type": "text", "text": "hello" }
    },
    {
      "id": 2,
      "timestamp": "2026-03-14T15:30:05Z",
      "event": "sent",
      "from": "bot",
      "content": { "type": "text", "text": "Hi!", "file_id": null }
    }
  ]
}
```

**Event types:** `message` (inbound), `sent` (outbound), `callback` (button press), `reaction`, `edit` (bot edit), `user_edit`.

## Security

- `dump_session_record` contains sensitive personal content (voice transcripts, file metadata, locations, contacts). Follow the PII guidance in [security-model.md](security-model.md).
- Session log files are sent as Telegram documents — they are subject to Telegram's own storage and retention policies.
- The store is in-memory only. No data touches disk unless explicitly dumped.

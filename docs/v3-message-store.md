# V3 — Message Store Architecture

> Replaces opt-in session recording with an always-on message store.
> Replaces four polling tools with one universal `dequeue_update`.
> Net result: fewer tools, less agent ceremony, lower token cost.

---

## Core Concept: Producer–Consumer Queue

```text
Telegram Bot API
       │
       ▼  getUpdates (background poller)
       │
       ├─ voice? ─→ ✍ react → transcribe → � react
       │             result: { type: "voice", text: "..." }
       │
       ▼  recordInbound(update, transcribedText?)
┌──────────────────────────────────────────────────┐
│               MessageStore                       │
│          (all FIFO via SimpleQueue<T>)             │
│                                                  │
│  Timeline: Queue<TimelineEvent>      (max 1000)  │
│                ↑         ↑                       │
│  Index:  Map<msg_id, Map<ver, evt>>  (max 500)   │
│          same objects — no duplication            │
│                                                  │
│  Queue:  response lane │ message lane            │
│                                                  │
│  Inbound  → timeline + index + enqueue           │
│  Outbound → timeline + index (no enqueue)        │
└──────┬───────────────┬───────────────────────────┘
       │               │
   dequeue_update   get_message
   (sequential)     (random access)
       │
       ▼
   AI Agent
```

- **Producer:** Background poller → `store.recordInbound(update)`
- **Consumer:** Agent calls `dequeue_update` to consume sequentially
- **Index:** `get_message(id, version?)` for random access
- **Dump:** `dump_session_record()` returns the full timeline as JSON

---

## Data Model

### TimelineEvent — The Canonical Object

Every action (message, send, reaction, edit, callback) produces one `TimelineEvent`:

```jsonc
{
  "id": 4200,                    // message_id this event relates to
  "timestamp": "2026-03-11T14:30:00.123Z",
  "event": "message",           // message | sent | reaction | callback | edit | user_edit
  "from": "user",               // "user" or "bot"
  "content": {                   // event-specific payload
    "type": "text",
    "text": "Fix the login bug"
  }
}
```

Field order is intentional: `id → timestamp → event → from → content` for readability.

### Event Types

| Event | From | Description |
| --- | --- | --- |
| `message` | user | New inbound message (text, voice, photo, doc, etc.) |
| `sent` | bot | Bot sent a message |
| `edit` | bot | Bot edited a previous message (version history tracked) |
| `user_edit` | user | User edited a message (silent store update, logged but not enqueued) |
| `reaction` | user/bot | Reaction added/removed on a message |
| `callback` | user | Inline button pressed |

### Content Subtypes

The `content.type` field classifies the payload:

| Type | Fields | `file_id` | Example |
| --- | --- | --- | --- |
| `text` | `text` | — | `{ "type": "text", "text": "Hello" }` |
| `command` | `text` (command name), `data` (args) | — | `{ "type": "command", "text": "status", "data": "all" }` |
| `voice` | `text` (pre-transcribed) | **No** — discarded after transcription | `{ "type": "voice", "text": "Hey, can you fix that bug?" }` |
| `doc` | `name`, `mime`, `caption`, `file_id` | **Yes** — retained until rolloff | `{ "type": "doc", "name": "report.pdf", "mime": "...", "file_id": "BQA..." }` |
| `photo` | `caption`, `file_id` | **Yes** — retained until rolloff | `{ "type": "photo", "caption": "Check this", "file_id": "AgA..." }` |
| `video` | `name`, `mime`, `caption`, `file_id` | **Yes** — retained until rolloff | `{ "type": "video", "name": "clip.mp4", "file_id": "BAA..." }` |
| `audio` | `name`, `mime`, `caption`, `file_id` | **Yes** — retained until rolloff | `{ "type": "audio", "name": "track.mp3", "file_id": "CQA..." }` |
| `sticker` | `emoji` | — | `{ "type": "sticker", "emoji": "😂" }` |
| `cb` | `data`, `qid`, `target` | — | `{ "type": "cb", "data": "approve", "qid": "xyz", "target": 4200 }` |
| `reaction` | `target`, `added`, `removed` | — | `{ "type": "reaction", "target": 4201, "added": ["👍"] }` |

> **`file_id` is on the content, not hidden in `_update`.** For downloadable file types (doc, photo, video, audio), the Telegram `file_id` is extracted into `EventContent` at recording time. The agent can pass it to `download_file` without needing `get_message`. Voice messages are the exception — after transcription, the audio is discarded and only the text is retained. See [File Retention Policy](#file-retention-policy).

### Two Access Patterns, One Set of Objects

```text
Timeline: [ evt₁, evt₂, evt₃, evt₄, evt₅ ]   ← ordered event log (dump)
                ↑              ↑
Index:    4200 → { -1: evt₁ } │                ← random access (get_message)
          4201 → { -1: evt₃ }─┘
```

The timeline array and the index map point to the **same `TimelineEvent` objects** — no duplication.

---

## Store Structure

### Index: Rolling 500 Message IDs

```ts
Map<message_id, Map<version, TimelineEvent>>
```

Each message starts with a single entry at version `-1` (current):

```text
4200 → { -1: entry }          // no edits — one slot
```

#### Bot-Message Edits (version history tracked)

When a **bot-sent** message is edited (via `edit_message_text`), the original
is preserved as version `0`, and the updated content becomes the new `-1`:

```text
4200 → { -1: updated, 0: original }   // one edit
4200 → { -1: latest, 0: original, 1: first_edit }   // two edits
```

This lets the agent review what it previously sent via `get_message(4200, 0)`.

#### User-Message Edits (no version history)

Telegram delivers `edited_message` updates for user edits. These **silently
overwrite** the `-1` entry in the store so `get_message` stays accurate, but:

- No version history is created (no `0`, `1`, `2` slots)
- Not enqueued for `dequeue_update`

Once the agent has dequeued and acted on the original, the edit is irrelevant.
If the user wants to correct course, they'll send a new message.

### Version Semantics

| Key | Meaning |
| --- | --- |
| `-1` | **Current** — always the latest known state of the message |
| `0` | Original content (bot messages only — created on first edit) |
| `1`, `2`, … | Edit history in order (bot messages only) |

### Capacity

- Rolling limit of **500 unique message_ids** in the outer map.
- When the 501st message arrives, the oldest message_id (and all its versions) is evicted.
- Edits to existing messages do **not** consume new slots — they add versions within an existing entry.

### Bot-Sent Messages

Messages sent by the bot are **indexed** (available via `get_message`) but **NOT enqueued** for `dequeue_update`. The agent already has the `message_id` from the send response — there's no reason to echo it back through the queue.

### Ephemeral Messages (Not Logged)

Some bot-sent messages are **ephemeral** — they exist only as transient UI and are excluded from both the timeline and the index:

| What | In timeline? | In index? | Notes |
| --- | --- | --- | --- |
| `send_text` | **Yes** | **Yes** | Normal recorded message |
| `show_animation` (any mode) | **No** | **No** | Ephemeral placeholder. Server-managed lifecycle. |
| `cancel_animation()` (no text) | **No** | **No** | Deletes ephemeral — nothing to log. |
| `cancel_animation({ text })` | **Yes** | **Yes** | Placeholder becomes a real, logged message. |
| `notify` | **Yes** | **Yes** | Recorded — it's real communication. |

The timeline should reflect the *actual conversation*, not transient "Thinking..." placeholders that were replaced moments later.

### Deleted Messages

Telegram's Bot API **does not notify bots about message deletions** — there is no `deleted_message` update type. If a user deletes a message after it was enqueued, the store has no way to know. The entry remains in the store and the queue. This is a Telegram platform limitation.

---

## Queue & Dequeue

### Two-Lane Priority Queue

The queue has two lanes:

| Lane | Contents | Priority |
| --- | --- | --- |
| **Response lane** | Reactions, callback queries — updates that reference an existing message | **High** (drained first) |
| **Message lane** | New inbound messages, commands, media | Normal |

`dequeue_update` always drains the response lane before the message lane. This ensures the agent processes context about messages it already knows about (reactions, button presses) before being handed new work.

Classification is simple:

- Has `message_reaction` → response lane
- Has `callback_query` → response lane
- Everything else → message lane

Note: `edited_message` updates from the user are **not enqueued** at all — they silently update the store (see [Version Tracking](#index-rolling-500-message-ids) above).

### Voice Transcription Pipeline

Voice messages are **transcribed preemptively** by the background poller — before they enter the queue. The agent never sees raw audio.

```text
Voice message arrives
       │
       ▼  react ✍ (transcribing)
   transcribeVoice(file_id)
       │
       ▼  swap to � (transcribed, queued)
   recordInbound() with { type: "voice", text: "..." }
       │
       ▼  agent dequeues
   swap 😴 → 🫡 (acknowledged)
```

**Three-phase reaction lifecycle:**

| Phase | Emoji | Meaning |
| --- | --- | --- |
| Transcribing | ✍ | Audio is being processed |
| Queued | � | Transcription complete, waiting for agent |
| Acknowledged | 🫡 | Agent has dequeued and will act on it |

**Why preemptive?**

- **Zero latency for the agent.** By the time `dequeue_update` returns, the voice is already text. The agent never blocks on transcription.
- **Faster interaction.** The user sends a voice note, sees ✍ immediately, then � within seconds. The transcription happens in parallel with whatever the agent is currently doing.
- **Simpler agent code.** Voice messages arrive as `{ type: "voice", text: "..." }` — same shape as text messages, just with a different type tag. No special handling needed.
- **Audio discarded.** After transcription, the voice audio is not retained. No `file_id` on the content, no `_update` stored. The event is pure text. See [File Retention Policy](#file-retention-policy).

If transcription fails, the content is `{ type: "voice", text: "[transcription failed: ...]" }` — the agent sees the failure inline and can ask the user to resend or type instead.

#### Async & Parallel Transcription

The poller processes a batch of updates on each `getUpdates` cycle. Voice messages in that batch are transcribed **concurrently** — not sequentially:

```typescript
// Poller pseudo-code per batch
const pending: Promise<void>[] = [];
for (const update of batch) {
  if (update.message?.voice) {
    // Fire-and-forget: transcribe + react + record
    pending.push(transcribeAndRecord(update));
  } else if (!handleIfBuiltIn(update)) {
    store.recordInbound(update);
  }
}
// Non-voice messages are recorded immediately.
// Voice messages resolve asynchronously.
// Next getUpdates call can proceed without waiting.
```

**Consequences:**

- Multiple simultaneous voice notes transcribe in parallel via `Promise.all`-style concurrency — wall-clock time equals the slowest transcription, not the sum.
- Non-voice messages are **never blocked** by an ongoing transcription. Text arrives instantly regardless of pending voice work.
- Voice messages may enter the queue slightly out of order relative to surrounding text messages (a slow transcription might finish after a fast one). This is acceptable — each voice note is self-contained.
- The ✍ reaction appears immediately on all voice messages in the batch. As each finishes, it individually swaps to �.

### Queue Lanes

Two `Queue<QueueItem>` instances — `_responseLane` and `_messageLane`. `dequeue_update` calls `_responseLane.dequeue()` first; falls through to `_messageLane.dequeue()` only when the response lane is empty. Both are unbounded — the agent's consumption is the only drain.

### `pending` Count

Every `dequeue_update` response includes a `pending` field — the number of updates still waiting in the queue after the current batch is consumed.

```jsonc
// With pending messages:
{ "id": 4200, "type": "text", "text": "Fix the login bug", "pending": 3 }

// No pending messages — field omitted entirely:
{ "id": 4200, "type": "text", "text": "Fix the login bug" }
```

`pending` is **omitted when 0** to save tokens in the common case. Its presence signals "there's more" — the agent checks for the field and decides whether to dequeue again. See [Agent Consumption Pattern](#agent-consumption-pattern) below.

---

## Compact Dequeue Format

`dequeue_update` returns events in their `TimelineEvent` format — but with `_update` stripped and `timestamp` omitted (the agent doesn't need raw Telegram data or timestamps to act). The result is compact:

```jsonc
// Text
{ "id": 4200, "event": "message", "from": "user", "content": { "type": "text", "text": "Fix the login bug" } }

// Voice (pre-transcribed — zero latency, agent sees text immediately)
{ "id": 4201, "event": "message", "from": "user", "content": { "type": "voice", "text": "Hey, can you fix the login page?" } }

// Slash command
{ "id": 4202, "event": "message", "from": "user", "content": { "type": "command", "text": "status", "data": "all" } }

// Document
{ "id": 4203, "event": "message", "from": "user", "content": { "type": "doc", "name": "report.pdf", "mime": "application/pdf" } }

// Callback query
{ "id": 4200, "event": "callback", "from": "user", "content": { "type": "cb", "data": "approve", "qid": "xyz", "target": 4200 } }

// Reaction
{ "id": 4201, "event": "reaction", "from": "user", "content": { "type": "reaction", "target": 4201, "added": ["👍"] } }
```

If `pending > 0`, it's included at top level: `{ "id": ..., "event": ..., ..., "pending": 3 }`. Omitted when 0.

**Omitted from dequeue** (available via `get_message`):

- `timestamp`, `_update` (raw Telegram data)
- `file_id`, `file_size`, `file_unique_id`, dimensions
- Full media metadata

---

## Agent Consumption Pattern

The `pending` count in every dequeue response gives the agent full control over pacing. The recommended pattern:

1. **Dequeue one update.** Handle it fully.
2. **Check `pending`.** If `pending > 0`, dequeue the next update.
3. **If the next update is a continuation** (reply to the same thread, follow-up message), handle it together with the current work.
4. **If the next update is unrelated** (new topic, different request), **park it** — acknowledge receipt to the user (e.g. react 👀), finish the current task first, then come back to the parked message.
5. **If `pending` is 0**, call `dequeue_update` with a timeout to block for the next message.

This prevents the agent from context-switching on every message while still staying responsive. The response lane priority ensures reactions and button presses (which are quick to handle) never get stuck behind a long queue of new messages.

> **Guidance for agents:** When you dequeue a pending message that isn't a continuation of your current work, react with 👀 to signal "I see this, I'll get to it" — then finish what you're doing first. The user sees the reaction and knows their message wasn't lost.

---

## Tool API — LESS IS MORE

> **Principle:** Instead of 5 ways to do things, there's one — unless collapsing them makes the action more confusing. Every tool earns its slot.

V2 has **40 tools**. V3 targets **29** — a 28% reduction.

### Philosophy

1. **One tool per concept.** Five media tools → one `send_file`. Four polling tools → one `dequeue_update`.
2. **Parameters over tools.** `cancel_typing` → `show_typing` with `cancel: true`. `unpin_message` → `pin_message` with `unpin: true`.
3. **Keep semantic tools that save tokens.** `notify` formats a severity-prefixed notification in one call. Without it, the agent would build `"ℹ️ **Title**\n\nbody"` every time — wasted tokens and formatting bugs. Keep it.
4. **Compound tools stay.** `ask`, `choose`, `send_confirmation` handle the full send→wait→cleanup cycle internally. The alternative is 3–5 tool calls. Keep them.

### Removed (12 tools)

| Tool | Reason |
| --- | --- |
| `wait_for_message` | → `dequeue_update` |
| `wait_for_callback_query` | → `dequeue_update` |
| `get_update` | → `dequeue_update` |
| `get_updates` | → `dequeue_update` |
| `start_session_recording` | Always on — no opt-in |
| `cancel_session_recording` | Always on — no cancel |
| `get_session_updates` | → `dump_session_record` |
| `send_message` | → `send_text` (renamed, voice mode removed) |
| `send_temp_message` | → `show_animation` (single-frame = static ephemeral) |
| `cancel_typing` | → `show_typing` with `cancel: true` |
| `unpin_message` | → `pin_message` with `unpin: true` |
| `send_message_draft` | → `show_animation` (replaced by animation system) |

### Added (5 tools)

| Tool | Parameters | Description |
| --- | --- | --- |
| `dequeue_update` | `timeout?: number` | Consume the next update from the queue (response lane first, then message lane). Blocks up to `timeout` seconds if queue is empty. Returns compact format + `pending` count. |
| `get_message` | `message_id: number, version?: number` | Random-access lookup. Default version = latest; `0` = original; `1`+ = edit history. Full detail including media metadata and `file_id`. |
| `show_animation` | `frames?, interval?, timeout?` | Start a server-managed cycling visual placeholder. See [Message Animation & Streaming](#message-animation--streaming). |
| `cancel_animation` | `text?, parse_mode?` | Stop animation. Optionally replace placeholder with a real message. |
| `append_text` | `message_id, text, parse_mode?` | Delta-append text to an existing message. Server-side concatenation — agent sends only the new chunk. |

### Renamed (1 tool)

| Old Name | New Name | Why |
| --- | --- | --- |
| `send_message` | `send_text` | Clearer intent. Voice mode removed — use `send_text_as_voice` for TTS. |

### Consolidated: Media Tools (5 → 1)

`send_photo`, `send_document`, `send_video`, `send_audio`, `send_voice` → **`send_file`**

```typescript
send_file({
  file: string,        // local path, HTTPS URL, or file_id
  type?: "auto" | "photo" | "document" | "video" | "audio" | "voice",  // default: "auto"
  caption?: string,
  parse_mode?: "Markdown" | "HTML",
  // Type-specific optional fields:
  duration?: number,   // audio, video, voice
  performer?: string,  // audio
  title?: string,      // audio
  width?: number,      // video
  height?: number,     // video
  disable_notification?: boolean,
  reply_to_message_id?: number,
})
```

**Auto-detection rules** (when `type = "auto"`):

1. Path/URL ends in `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp` → `photo`
2. Path/URL ends in `.mp4`, `.mov`, `.avi`, `.mkv` → `video`
3. Path/URL ends in `.mp3`, `.m4a`, `.flac`, `.wav` → `audio`
4. Path/URL ends in `.ogg`, `.oga` → `voice`
5. Everything else → `document`
6. If a `file_id` is passed and type isn't specified, the agent must provide `type` explicitly

### Folded Into Existing Tools (2 → 0)

| Former Tool | Now | How |
| --- | --- | --- |
| `cancel_typing` | `show_typing` | Pass `cancel: true`. Immediately stops the typing indicator. |
| `unpin_message` | `pin_message` | Pass `unpin: true`. Omit `message_id` to unpin the most recent. |

### Simplified (1 tool)

| Tool | Change |
| --- | --- |
| `dump_session_record` | No parameters. Returns full timeline as JSON. No start/stop/clean — always on. |

### Compound Convenience (3 tools — kept)

| Tool | Behavior |
| --- | --- |
| `ask` | Sends question → blocks for reply → returns text/voice response |
| `choose` | Sends inline buttons → blocks for press → returns selection |
| `send_confirmation` | Sends Yes/No → blocks → returns `{ confirmed }` |

These consume from the queue internally — the agent never sees the raw callback.

### Final Tool List (30 tools)

| # | Tool | Category | Notes |
| --- | --- | --- | --- |
| 1 | `dequeue_update` | **Polling** | Universal consumption — replaces 4 tools |
| 2 | `get_message` | **Polling** | Random-access lookup by message_id + version |
| 3 | `send_text` | **Send** | Text messages. Always logged. |
| 4 | `send_text_as_voice` | **Send** | TTS → voice note |
| 5 | `send_file` | **Send** | All file types — replaces 5 tools |
| 6 | `notify` | **Send** | Severity-prefixed notification |
| 7 | `edit_message_text` | **Send** | Edit in-place |
| 8 | `append_text` | **Send** | Delta-append to existing message (server-side concat) |
| 9 | `delete_message` | **Send** | Delete a message |
| 10 | `forward_message` | **Send** | Forward to another chat |
| 11 | `show_animation` | **Visual** | Server-managed cycling placeholder — replaces `send_draft` |
| 12 | `cancel_animation` | **Visual** | Stop animation; optionally replace with real message |
| 13 | `ask` | **Interact** | Question → text reply |
| 14 | `choose` | **Interact** | Options → button press |
| 15 | `send_confirmation` | **Interact** | Yes/No → boolean |
| 16 | `answer_callback_query` | **Interact** | Acknowledge button press |
| 17 | `show_typing` | **Status** | Sustained typing indicator. `cancel: true` to stop. |
| 18 | `send_chat_action` | **Status** | One-shot action (upload_photo, record_video, etc.) |
| 19 | `update_status` | **Status** | Live task checklist |
| 20 | `set_reaction` | **React** | Emoji reaction on a message |
| 21 | `pin_message` | **Pin** | Pin or unpin (`unpin: true`) |
| 22 | `download_file` | **File** | Download by file_id |
| 23 | `transcribe_voice` | **File** | On-demand re-transcription |
| 24 | `set_commands` | **Config** | Register slash commands |
| 25 | `set_topic` | **Config** | Set title prefix |
| 26 | `get_me` | **Info** | Bot identity |
| 27 | `get_chat` | **Info** | Chat details |
| 28 | `get_agent_guide` | **Info** | Behavior guide |
| 29 | `dump_session_record` | **Session** | Full timeline JSON |
| 30 | `restart_server` | **System** | Exit for relaunch |

### What Didn't Get Cut (and Why)

| Tool | Why Kept |
| --- | --- |
| `notify` | Semantic formatting (emoji + severity + bold title) saves tokens. Without it, agent manually formats every notification — error-prone and verbose. |
| `send_chat_action` | Different from `show_typing`. Supports 11 action types (upload_photo, record_video, etc.) as one-shot signals. `show_typing` is sustained-repeat for "typing..." only. |
| `answer_callback_query` | Low-level primitive needed for custom inline keyboards outside `choose`/`send_confirmation`. |
| `transcribe_voice` | Pre-transcription handles the common case, but agents may need to transcribe audio files or re-attempt failed transcriptions on demand. |
| `show_animation` / `cancel_animation` | Replaces `send_draft` with a server-managed system. The server handles the animation lifecycle transparently — the agent just says "I'm working" and "I'm done." `cancel_animation({ text })` lets the placeholder become the final answer. |
| `append_text` | Server-side delta concat eliminates the O(N²) token cost of full-text re-sends. Essential for streaming-style message building. |
| `forward_message` | Unique Telegram capability. No way to replicate with other tools. |

---

## `get_message` API

```ts
get_message(message_id: number, version: number = -1)
```

- `get_message(4200)` → latest version (version defaults to `-1`)
- `get_message(4200, 0)` → original
- `get_message(4200, 1)` → first edit

Returns full message details — all fields the compact format omits:

- Full text/caption
- `file_id`, `file_size`, `file_unique_id` (for downloadable files — not voice)
- Media dimensions, duration, MIME type
- `from`, `chat`, `date`
- Reply chain reference
- Inline keyboard state (for bot messages)

**Note:** For voice messages, `get_message` returns the transcribed text but no `file_id` or `_update` — the audio is discarded after transcription. Use `transcribe_voice` to re-download and re-transcribe if needed.

Returns error if `message_id` is not in the store (evicted or never seen).

---

## Message Animation & Streaming

> **Problem:** Agents need to signal "I'm working" visually beyond a typing indicator, and they need to build messages progressively without the O(N²) cost of resending full accumulated text on every edit.

### Three New Tools

#### `show_animation` — Managed Visual Placeholder

```typescript
show_animation({
  frames?: string[],    // default: ["⏳", "⌛"]. Single frame = static placeholder.
  interval?: number,    // ms between frames; default: 2000, min: 1500. Ignored if 1 frame.
  timeout?: number,     // seconds of inactivity before auto-cleanup; default: 30, max: 600
})
```

**How it works — the server manages everything:**

1. Agent calls `show_animation()` — animation message appears.
2. Agent sends any outbound message (`send_text`, `notify`, `send_file`, etc.) — the server **transparently** edits the animation message to show the real content (it becomes a logged message), then sends a **new** animation message below it.
3. Step 2 repeats for every outbound message. The animation is always the last thing visible — always moving down.
4. Agent calls `cancel_animation()` — the trailing animation is deleted. Done.

**The agent doesn't know about step 2's internal mechanics.** From the agent's perspective, it showed an animation and cancelled it. Everything in between is just normal `send_text` calls. The server handles the visual continuity.

**Why edit-in-place?** Two API calls per juggle (edit + send) instead of three (delete + send + send). Zero flicker — the animation message seamlessly becomes the real message. No message deletion means no visual gap. The former animation message is now a real, indexed, logged message.

**Timeout:** The animation auto-cleans if no outbound activity occurs within `timeout` seconds (default: 30). The timer resets on any operation that sends, edits, or deletes a message in the user's chat:

| Resets timeout | Doesn't reset timeout |
| --- | --- |
| `send_text`, `notify`, `send_file`, `send_text_as_voice` | `get_me`, `get_chat`, `get_agent_guide` |
| `edit_message_text`, `append_text` | `set_commands`, `set_topic` |
| `delete_message`, `forward_message` | `download_file`, `transcribe_voice` |
| `set_reaction`, `pin_message` | `dequeue_update`, `get_message` |
| `ask`, `choose`, `send_confirmation` (send internally) | `dump_session_record`, `restart_server` |
| `update_status`, `show_typing`, `send_chat_action` | |

**Rule:** If it calls a Telegram Bot API method that modifies the chat, it resets the timer. Read-only and config tools do not.

This means an agent can stream content into a prior message via `append_text` while the animation stays alive below it — the edits keep the timer ticking.

```text
show_animation()                             → ⏳ appears (30s timer starts)
  ... agent works (< 30s) ...
send_text("*Analysis*\n\n...")              → ⏳ replaced with block 1, NEW ⏳ below (timer resets)
  ... agent works (< 30s) ...
send_text("*Fix*\n\n...")                   → ⏳ replaced with block 2, NEW ⏳ below (timer resets)
cancel_animation()                           → final ⏳ deleted. Done.
```

**Streaming + animation combo:**

```text
show_animation({ frames: ["⚙️ Working..."] })   → placeholder appears
send_text("*Results*")                           → ⚙️ replaced with msg 5001, NEW ⚙️ below (timer resets)
append_text({ message_id: 5001, text: "- result A" })  → timer resets
append_text({ message_id: 5001, text: "- result B" })  → timer resets
cancel_animation({ text: "✅ Done — 2 results." })     → placeholder becomes summary
```

**Returns:** `{ message_id }` — the ID of the current animation message. This ID is ephemeral — not queryable via `get_message()` (animation messages are not indexed). Useful only if the agent wants to pass it to `cancel_animation` in a future extension.

**Other behavior:**

- **Not logged:** Animation messages are ephemeral — excluded from timeline and index.
- **One at a time.** Showing a new animation auto-cancels the previous one.
- **Static placeholder:** `show_animation({ frames: ["🔍 Searching..."] })` — one frame, no cycling. Acts as a temporary message that auto-cleans on next send or timeout.
- **Error recovery:** Best-effort. If a Telegram API call fails mid-juggle (e.g., `editMessageText` 400 because user deleted the animation), the animation state resets to idle. Failures are swallowed — a missing animation is cosmetic, not fatal. The agent is never notified of animation failures.
- **Agent crash / disconnect:** The timeout handles this — animation self-cleans after `timeout` seconds of silence. No orphan cleanup needed.

**Frame examples:**

```jsonc
// Default thinking (cycling)
{ "frames": ["⏳", "⌛"] }

// Explicit thinking (cycling)
{ "frames": ["🤔 Thinking.", "🤔 Thinking..", "🤔 Thinking..."] }

// Static placeholder (no cycling)
{ "frames": ["🔍 Searching the codebase..."] }

// Working indicator
{ "frames": ["⚙️ Working", "⚙️ Working.", "⚙️ Working.."] }
```

**Rate limiting:** The minimum interval is 1500ms. Telegram throttles `editMessageText` at roughly 1 edit/second per message, so 1500ms stays safely under that limit. The server enforces this floor.

#### `cancel_animation` — Stop, Replace, or Clean Up

```typescript
cancel_animation({
  text?: string,              // optional replacement message
  parse_mode?: "Markdown",    // parse mode for replacement text
})
```

**Without `text`:** Deletes the trailing animation message immediately. No-op if no animation is active. Returns `{ cancelled: true }` if an animation was removed, `{ cancelled: false }` if none was active.

**With `text`:** Edits the animation message to show the provided text, stops the animation cycle, and the message becomes a **normal logged message** (indexed and in the timeline). The animation placeholder transforms into real content in one call — no flicker, no delete-then-send. Returns `{ cancelled: true, message_id }` of the now-permanent message.

```text
show_animation({ frames: ["🔍 Searching..."] })
  ... agent searches ...
cancel_animation({ text: "✅ Found 3 results." })   → placeholder becomes real message
```

Returns `{ cancelled: true, message_id }` — the agent can use that `message_id` for subsequent `append_text` or `edit_message_text` calls.

#### Why Two Tools Instead of One

We folded `cancel_typing` into `show_typing({ cancel: true })` — why not do the same here?

Because `show_animation` and `cancel_animation` are **not the same action with a flag**. `show_animation` creates a resource with configuration (frames, interval, timeout). `cancel_animation` destroys it. `show_typing` toggles a stateless Telegram action — `cancel: true` is a natural inversion. But `show_animation({ cancel: true })` would mean "show an animation that... cancels?" — contradictory naming. Separate tools = self-documenting.

#### `show_typing` vs `show_animation`

| | `show_typing` | `show_animation` |
| --- | --- | --- |
| **What user sees** | Native Telegram "typing..." bubble | Custom emoji/text message |
| **Creates a message** | No | Yes (ephemeral) |
| **Content** | Fixed ("typing...") | Agent-defined (frames) |
| **Duration** | Until cancelled or 5s timeout | Until cancelled or custom timeout |
| **Telegram API** | `sendChatAction` (free, no rate limit) | `sendMessage` + `editMessageText` (rate-limited) |
| **Use when** | Quick responses, lightweight | Long tasks, custom status, segmented streaming |

They complement, not compete. `show_typing` is the lightweight default; `show_animation` is for when the agent wants to say *what* it's doing, not just *that* it's doing something.

#### Implementation Hook

The animation juggle (edit → send new animation) requires a hook in every outbound tool. Two options:

1. **Explicit helper** (like existing `clearPendingTemp()` pattern): Each outbound tool calls `animationBeforeSend()` / `animationAfterSend()`. Matches current architecture — no refactor needed.
2. **Centralized outbound layer**: Wrap all send tools in middleware. Cleaner but requires a larger refactor.

Option 1 is the pragmatic choice for V3 — it mirrors `clearPendingTemp()` and `cancelTyping()` calls already in outbound tools. Option 2 is a future consideration if the coordination burden grows.

#### `append_text` — Server-Side Delta Concatenation

```typescript
append_text({
  message_id: number,       // message to append to
  text: string,             // new chunk to add (appended with \n separator)
  separator?: string,       // default: "\n" — join character between chunks
  parse_mode?: "Markdown",  // re-render after append
})
```

**Behavior:**

- Reads the current text of `message_id` from the store's index, concatenates `text` after `separator`, and calls `editMessageText` with the result.
- The agent sends only the **delta** — the server handles accumulation.
- **Token cost: O(1) per call** for the agent (sends only the new chunk). The API call is O(N) total text, but that's Telegram's problem, not the agent's token budget.
- **Logged:** Each append creates an `edit` event in the timeline with the full accumulated text (matching what the user sees).
- **Works with animation:** Agent can `show_animation` a placeholder, then `append_text` to build content. The first `append_text` call to the animation message stops the animation and replaces the placeholder frame with the first text chunk.

> **Guidance for agents:** `append_text` is for **additive corrections and supplements** to an existing message — not for simulating streaming. If you have multiple discrete blocks of content, prefer the [Segmented Streaming Pattern](#the-segmented-streaming-pattern-recommended) (separate `send_text` calls with `show_animation` as a rolling pre-message). Reserve `append_text` for when you genuinely want to grow a single message — e.g. appending a "## Update" section to a prior status message, or building a list item-by-item as results arrive.

**Example — building a single message incrementally:**

```text
Agent: send_text("*Search Results*")  →  message_id: 5001
  ... first batch of results arrives ...
Agent: append_text({ message_id: 5001, text: "- result-a: ..." })
  ... more results ...
Agent: append_text({ message_id: 5001, text: "- result-b: ..." })
Agent: append_text({ message_id: 5001, text: "\n_3 results found._" })
```

### The Segmented Streaming Pattern (Recommended)

The preferred way to deliver multi-part content. The agent calls `show_animation`, then sends blocks. The server transparently manages the animation — replacing it with each real message and sending a new animation below. The agent doesn't know or care about that cycle:

```text
┌──────────────────────────────────┐
│ User: "Analyze the login bug"    │  ← user message
├──────────────────────────────────┤
│ ⏳                                │  ← show_animation()
└──────────────────────────────────┘
          ↓ agent sends block 1
┌──────────────────────────────────┐
│ User: "Analyze the login bug"    │
├──────────────────────────────────┤
│ *Analysis*                       │  ← send_text (server replaced ⏳
│ The login bug is caused by...    │     with this, sent NEW ⏳ below)
├──────────────────────────────────┤
│ ⌛                                │  ← server-managed, invisible to agent
└──────────────────────────────────┘
          ↓ agent sends block 2
┌──────────────────────────────────┐
│ *Analysis*                       │
│ The login bug is caused by...    │
├──────────────────────────────────┤
│ *Fix*                            │  ← send_text (server replaced ⌛
│ Changed `auth.ts` line 42...     │     with this, sent NEW ⏳ below)
├──────────────────────────────────┤
│ ⏳                                │  ← server-managed, invisible to agent
└──────────────────────────────────┘
          ↓ agent is done
┌──────────────────────────────────┐
│ *Analysis*                       │
│ The login bug is caused by...    │
├──────────────────────────────────┤
│ *Fix*                            │
│ Changed `auth.ts` line 42...     │
└──────────────────────────────────┘
          (cancel_animation removed trailing ⏳)
```

**Agent calls:**

```text
show_animation()
send_text("*Analysis*\n\nThe login bug is caused by...")
send_text("*Fix*\n\nChanged `auth.ts` line 42...")
cancel_animation()
```

Four calls. The agent has no idea the animation was being juggled between messages — it just showed it and cancelled it. The visual continuity is the server's job.

**Why this is better than streaming:**

1. **No O(N²) token cost.** Each `send_text` is a fixed-cost call with only its own content.
2. **No flickering.** Telegram renders each message once, not re-rendering on every edit.
3. **Natural pacing.** Separate messages look intentional, not like a waterfall of text.
4. **Mobile-friendly.** Users on phones see discrete notifications for each block, not silent edits to a message they've scrolled past.
5. **Always-visible progress.** The rolling animation at the bottom tells the user "more is coming" — never a dead silence.
6. **When Telegram ships native streaming** (likely), `show_animation` can be adapted to use it transparently — the agent's interface doesn't change.

### Comparison: V2 vs V3 Message Building

| Pattern | V2 | V3 |
| --- | --- | --- |
| **Thinking indicator** | `show_typing` (typing... bubble) | `show_animation` (visual emoji/text cycling) + `show_typing` still available |
| **Placeholder** | `send_temp_message` | `show_animation` (single frame = static placeholder) |
| **Streaming text** | `send_message_draft` (O(N²) tokens) | Segmented streaming (recommended) or `append_text` for single-message growth |
| **Progressive blocks** | N/A | `show_animation` + sequential `send_text` (server manages animation) |
| **Edit in place** | `edit_message_text` | `edit_message_text` (unchanged) or `append_text` for additive edits |

### Timeline Logging Rules

| Action | Logged? | Why |
| --- | --- | --- |
| `show_animation` / cycle | **No** | Ephemeral visual noise |
| `cancel_animation()` (no text) | **No** | Cleanup of ephemeral |
| `cancel_animation({ text })` | **Yes** | Placeholder becomes real message |
| `append_text` | **Yes** (as `edit` event) | The accumulated message IS the conversation |
| `send_text` | **Yes** | Always logged — real message |
| `notify` | **Yes** | Real message |

---

## `/session` Panel (Simplified)

```text
📼 Session · 47 messages stored
[📤 Dump] [✖ Dismiss]
```

No Start/Stop buttons — recording is always on.

---

## Dump Model

`dump_session_record` returns the full **timeline** as a JSON array — every event in chronological order.

```jsonc
[
  { "id": 4200, "timestamp": "...", "event": "message", "from": "user", "content": { "type": "text", "text": "Fix the login bug" } },
  { "id": 4201, "timestamp": "...", "event": "sent",    "from": "bot",  "content": { "type": "text", "text": "On it!" } },
  { "id": 4201, "timestamp": "...", "event": "reaction", "from": "user", "content": { "type": "reaction", "target": 4201, "added": ["👍"] } },
  { "id": 4201, "timestamp": "...", "event": "edit",    "from": "bot",  "content": { "type": "text", "text": "Done! Fixed in abc123" } },
  { "id": 4200, "timestamp": "...", "event": "callback", "from": "user", "content": { "type": "cb", "data": "approve", "qid": "xyz", "target": 4200 } },
  { "id": 4202, "timestamp": "...", "event": "message", "from": "user", "content": { "type": "text", "text": "Thanks!" } },
  { "id": 4202, "timestamp": "...", "event": "reaction", "from": "bot",  "content": { "type": "reaction", "target": 4202, "added": ["❤"] } }
]
```

- Structured, complete, human-readable
- Includes timestamps (unlike dequeue)
- Includes both user and bot actions (messages, sends, reactions, edits, callbacks)
- Bounded by rolling 1000 events
- `_update` (raw Telegram) stripped — just the clean event schema

A separate `export_session_log` tool transforms the timeline into a
human-readable `.log` or `.txt` file for archival.

---

## Internal Queue Architecture (`SimpleQueue<T>`)

All rolling FIFO structures use an inline `SimpleQueue<T>` — a circular buffer with O(1) enqueue/dequeue and non-destructive iteration.

### Five Queues

| Queue | Type | Cap | Eviction | Notes |
| --- | --- | --- | --- | --- |
| `_responseLane` | `Queue<QueueItem>` | ∞ | Agent dequeues | High-priority lane (reactions, callbacks) |
| `_messageLane` | `Queue<QueueItem>` | ∞ | Agent dequeues | Normal lane (messages, commands, media) |
| `_timeline` | `Queue<TimelineEvent>` | 1000 | FIFO roll-off | Canonical event log; iterated for dump |
| `_insertionOrder` | `Queue<number>` | 500 | FIFO roll-off | Tracks message_id age for index eviction |

The two queue lanes are unbounded — the agent consumes them. The timeline and insertion-order queues are capped — oldest entries silently roll off.

### Why Queue for Timeline?

The timeline serves two access patterns:

1. **Append** — every event is enqueued → O(1)
2. **Dump** — `dumpTimeline()` iterates the full queue → non-destructive spread `[...queue]`
3. **Evict** — when `count > MAX_TIMELINE`, dequeue oldest → O(1)

Before Queue, eviction was `_timeline = _timeline.slice(len - MAX)` — O(n) copying the entire array on every overflow. Queue's circular buffer makes the same operation O(1).

### Why Queue for InsertionOrder?

`_insertionOrder` tracks which `message_id` was added first so the index can evict the oldest when over 500. Current code uses `Array.shift()` — O(n) because every element shifts left. Queue makes this O(1).

### Cap Enforcement Pattern

```ts
function appendTimeline(event: TimelineEvent): void {
  _timeline.enqueue(event);
  while (_timeline.count > MAX_TIMELINE)
    _timeline.dequeue();  // oldest rolls off — O(1)
}

function trackInsertion(messageId: number): void {
  _insertionOrder.enqueue(messageId);
  while (_insertionOrder.count > MAX_MESSAGES) {
    const evicted = _insertionOrder.dequeue();
    if (evicted !== undefined) _index.delete(evicted);
  }
}
```

### `dumpTimeline()` — Non-Destructive Iteration

Queue implements `Iterable<T>` via `_getIterator()`. Spreading or `Array.from` reads without removing:

```ts
export function dumpTimeline(): Array<Omit<TimelineEvent, "_update">> {
  return Array.from(_timeline, ({ _update: _, ...rest }) => rest);
}
```

### `dequeueMatch()` — Drain & Requeue

Queue doesn't support middle-removal. For compound tools (`ask`, `choose`, `send_confirmation`) that need to pluck a specific callback from the queue:

```ts
function _scanAndRemove<T>(
  lane: Queue<QueueItem>,
  predicate: (event: TimelineEvent) => T | undefined,
): T | undefined {
  const items = lane.dump();  // destructive — empties the lane
  let found: T | undefined;
  for (const item of items) {
    if (found === undefined) {
      const result = predicate(item.event);
      if (result !== undefined) { found = result; continue; }
    }
    lane.enqueue(item);  // re-enqueue non-matches
  }
  return found;
}
```

This is O(n) in the worst case, but the queue is typically small (< 10 items) and `dequeueMatch` is rare (only for compound tools).

### Iteration

`SimpleQueue<T>` implements `Iterable<T>`, supporting spread, `Array.from`, and `for…of` over the timeline or queue contents.

---

## Command Architecture

### Built-in Commands (Server-Level)

Built-in commands are **server-level interrupts**. They are intercepted by `handleIfBuiltIn()` in the polling loop *before* `recordInbound()` is called — meaning they never enter the store, never appear in the timeline, and never reach the agent.

**Current built-in commands:**

| Command | Description | Handler |
| --- | --- | --- |
| `/session` | Session panel (dump, stats) | `handleSessionCommand()` |

**Lockdown rules:**

1. Built-in commands are registered in a `RESERVED_COMMANDS` set.
2. `set_commands` rejects any agent command whose name matches a reserved name — the agent cannot shadow built-ins.
3. Built-in commands always prepend the Telegram menu regardless of what the agent registers.
4. The interception layer runs before any recording — built-in commands are invisible to the store.

### Agent Commands (Custom)

Agents register custom slash commands via `set_commands`. Users type them in Telegram, and they arrive in the store as:

```jsonc
{ "type": "command", "text": "cancel", "data": "task-42" }
```

**Lifecycle:**

1. Agent calls `set_commands([{ command: "cancel", description: "Stop current task" }])`
2. Commands appear in Telegram's `/` autocomplete menu, merged with built-ins
3. User types `/cancel task-42`
4. Poller receives update → `handleIfBuiltIn()` returns `false` (not a built-in) → `recordInbound()` → enqueued in message lane
5. Agent dequeues, sees `type: "command"`, dispatches by `text` field

**Agent command format:** `content.text` is the command name (no `/` prefix), `content.data` is the arguments string (everything after the command, `undefined` if no args).

**Unknown commands:** If a user types `/foo` and no one registered it, the update still arrives as `{ type: "command", text: "foo" }`. The agent decides what to do — respond with "unknown command" or ignore it.

### Command Collision Prevention

```text
   User types /session           User types /cancel
         │                              │
         ▼                              ▼
  handleIfBuiltIn()              handleIfBuiltIn()
  → "session" in RESERVED        → "cancel" not in RESERVED
  → consume, handle panel        → pass through
  → return true                  → return false
         │                              │
    (invisible)                         ▼
                                recordInbound()
                                → agent dequeues
```

**Collision is impossible** because:

- Built-in check runs first on every update
- `set_commands` filters out reserved names at registration time
- Even if the agent somehow sends a raw Telegram API call registering a reserved name, the interception layer still consumes it server-side

### Command Visibility

| What | In timeline? | In queue? | Agent sees it? |
| --- | --- | --- | --- |
| Built-in command (`/session`) | **No** | **No** | **No** |
| Built-in command **output** (dump file sent by bot) | **Yes** | No (bot-sent) | Via `get_message` |
| Agent command (`/cancel`) | **Yes** | **Yes** | **Yes** via `dequeue_update` |
| Unknown command (`/foo`) | **Yes** | **Yes** | **Yes** via `dequeue_update` |

**Key insight:** The built-in command itself is invisible, but its *output* (e.g. a dump file the bot sends) appears in the timeline as a normal bot-sent message. The agent can target that message for `download_file` if needed.

---

## File Retention Policy

The store handles different file types differently based on their usefulness after initial processing:

### Voice Messages — Discard After Transcription

Voice audio is **ephemeral**. Once transcribed, the audio file has no further value:

- `EventContent` for voice: `{ type: "voice", text: "..." }` — pure text, no `file_id`
- `_update` field: **not stored** (set to `undefined`) — cannot re-download
- If the agent needs the original audio (rare), it should call `transcribe_voice` which re-downloads from Telegram
- Memory savings: voice `_update` objects are large (contain file metadata, chat info, etc.)

### Downloadable Files — Retain Until Rolloff

Documents, photos, videos, and audio files retain their `file_id` in `EventContent`:

- `EventContent` includes `file_id`: `{ type: "doc", name: "...", file_id: "BQA..." }`
- `_update` field: **stored** — available via `get_message` for full metadata
- Agent can call `download_file(file_id)` at any time while the event is in the store
- When a timeline event rolls off (>1000 events), its `_update` reference is garbage-collected naturally
- When a message_id is evicted from the index (>500 IDs), its version map is deleted

### What "Retain" Means

The store never holds actual file bytes. Telegram stores the files on its servers. The store holds:

- **`file_id`** in `EventContent` — an opaque reference usable for `download_file`
- **`_update`** on the `TimelineEvent` — the full Telegram `Update` object with all metadata

Both are in-memory JavaScript objects. They're freed automatically when items roll off the timeline or the process restarts.

### Retention Summary

| Content Type | `file_id` in content? | `_update` stored? | Downloadable? | Retained until... |
| --- | --- | --- | --- | --- |
| `text` | — | Yes | — | Timeline rolloff |
| `command` | — | Yes | — | Timeline rolloff |
| `voice` | **No** | **No** | **No** | Text only — audio discarded |
| `doc` | **Yes** | Yes | **Yes** | Timeline rolloff |
| `photo` | **Yes** | Yes | **Yes** | Timeline rolloff |
| `video` | **Yes** | Yes | **Yes** | Timeline rolloff |
| `audio` | **Yes** | Yes | **Yes** | Timeline rolloff |
| `sticker` | — | Yes | — | Timeline rolloff |
| `cb` | — | Yes | — | Timeline rolloff |
| `reaction` | — | No (no `_update`) | — | Timeline rolloff |

---

## Startup

One optional question at startup: auto-dump frequency (or set via `AUTO_DUMP_THRESHOLD` env var). If neither is configured, dumps are manual only.

---

## Files Changed

### Created

- `src/message-store.ts` — Store implementation
- `src/tools/dequeue_update.ts` — Universal consumption tool
- `src/tools/get_message.ts` — Random-access lookup tool
- `src/tools/send_text.ts` — Replaces `send_message.ts` (renamed, voice mode removed)
- `src/tools/send_file.ts` — Consolidates 5 media tools into one
- `src/tools/show_animation.ts` — Server-managed cycling placeholder (replaces `send_message_draft.ts`)
- `src/tools/cancel_animation.ts` — Stop animation; optionally replace with real message
- `src/tools/append_text.ts` — Delta-append to existing messages

### Deleted

- `src/session-recording.ts` — Replaced by message-store
- `src/update-buffer.ts` — Store IS the buffer
- `src/tools/start_session_recording.ts`
- `src/tools/cancel_session_recording.ts`
- `src/tools/get_session_updates.ts`
- `src/tools/get_update.ts`
- `src/tools/get_updates.ts`
- `src/tools/wait_for_message.ts`
- `src/tools/wait_for_callback_query.ts`
- `src/tools/send_message.ts` — Replaced by `send_text.ts`
- `src/tools/send_message_draft.ts` — Replaced by `show_animation.ts`
- `src/tools/send_photo.ts` — Consolidated into `send_file.ts`
- `src/tools/send_document.ts` — Consolidated into `send_file.ts`
- `src/tools/send_video.ts` — Consolidated into `send_file.ts`
- `src/tools/send_audio.ts` — Consolidated into `send_file.ts`
- `src/tools/send_voice.ts` — Consolidated into `send_file.ts`
- `src/tools/send_temp_message.ts` — Replaced by `show_animation` (single-frame mode)
- `src/tools/cancel_typing.ts` — Folded into `show_typing.ts`
- `src/tools/unpin_message.ts` — Folded into `pin_message.ts`

### Heavily Modified

- `src/tools/dump_session_record.ts` — JSON snapshot of store, no params
- `src/tools/show_typing.ts` — Absorbs `cancel_typing` via `cancel: true` param
- `src/tools/pin_message.ts` — Absorbs `unpin_message` via `unpin: true` param
- `src/built-in-commands.ts` — Simplified `/session` panel, `RESERVED_COMMANDS` set
- `src/telegram.ts` — Background poller, wire store, async voice transcription
- `src/server.ts` — Update tool registrations (40 → 30)
- `src/temp-message.ts` — Shared ephemeral cleanup used by `send_text`, `show_animation`
- `src/index.ts` — Remove session prefs prompt
- `src/tools/set_commands.ts` — Collision check against `RESERVED_COMMANDS`
- `src/update-sanitizer.ts` — Add compact serializer for dequeue

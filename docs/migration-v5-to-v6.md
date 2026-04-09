# Migration Guide: v5 → v6

Telegram Bridge MCP v6 consolidates the v5 API surface from 50+ standalone tools down to **4 tools** with type-based routing. All previous functionality is preserved — the access pattern has changed, not the capabilities.

## Overview

| Version | Tool count | Routing model |
| --- | --- | --- |
| v5 | 50+ standalone tools | Each feature = a separate tool |
| v6 | 4 tools | Type parameter routes to the right handler |

The four v6 tools:

| Tool | Purpose |
| --- | --- |
| `send` | All outbound messaging |
| `dequeue` | Receive inbound events (unchanged) |
| `help` | Documentation discovery (replaces `get_agent_guide`) |
| `action` | Everything else — session, config, message ops, history, logs |

---

## v5 → v6 Tool Mapping Table

### Messaging

| v5 Tool | v6 Equivalent |
| --- | --- |
| `send_text(text: "...")` | `send(type: "text", text: "...")` |
| `send_message(text: "...")` | `send(type: "text", text: "...")` |
| `send_text_as_voice(audio: "...")` | `send(type: "text", audio: "...")` |
| `notify(text: "...", severity: "info")` | `send(type: "notification", text: "...", severity: "info")` |
| `send_file(file: "...")` | `send(type: "file", file: "...")` |
| `send_choice(text: "...", options: [...])` | `send(type: "choice", text: "...", options: [...])` |
| `send_direct_message(target_sid: 1, text: "...")` | `send(type: "direct", target_sid: 1, text: "...")` |
| `append_text(message_id: 1, text: "...")` | `send(type: "append", message_id: 1, text: "...")` |
| `show_animation(frames: [...])` | `send(type: "animation", frames: [...])` |
| `send_new_checklist(title: "...", steps: [...])` | `send(type: "checklist", title: "...", steps: [...])` |
| `send_new_progress(title: "...", percent: 50)` | `send(type: "progress", title: "...", percent: 50)` |

### Interactive Questions

| v5 Tool | v6 Equivalent |
| --- | --- |
| `ask(ask: "What is your name?")` | `send(type: "question", ask: "What is your name?")` |
| `choose(text: "Pick one", options: [...])` | `send(type: "question", text: "Pick one", choose: [...])` |
| `confirm(confirm: "Are you sure?")` | `send(type: "question", confirm: "Are you sure?")` |
| `confirmYN(confirm: "Proceed?")` | `send(type: "question", confirm: "Proceed?")` |

### Session

| v5 Tool | v6 Equivalent |
| --- | --- |
| `session_start(name: "Worker")` | `action(type: "session/start", name: "Worker")` |
| `close_session()` | `action(type: "session/close")` |
| `list_sessions()` | `action(type: "session/list")` |
| `rename_session(name: "New Name")` | `action(type: "session/rename", name: "New Name")` |

### Configuration

| v5 Tool | v6 Equivalent |
| --- | --- |
| `set_voice(voice: "af_heart")` | `action(type: "config/voice", voice: "af_heart")` |
| `set_topic(topic: "Worker 1")` | `action(type: "config/topic", topic: "Worker 1")` |
| `save_profile(name: "Worker")` | `action(type: "config/profile/save", name: "Worker")` |
| `load_profile(name: "Worker")` | `action(type: "config/profile/load", name: "Worker")` |
| `import_profile(json: "...")` | `action(type: "config/profile/import", json: "...")` |
| `set_reminder(delay: 300, text: "Check build")` | `action(type: "config/reminder/set", delay: 300, text: "Check build")` |
| `cancel_reminder(id: "abc")` | `action(type: "config/reminder/cancel", id: "abc")` |
| `list_reminders()` | `action(type: "config/reminder/list")` |
| `set_dequeue_default(timeout: 60)` | `action(type: "config/dequeue-default", timeout: 60)` |
| `set_default_animation(preset: "thinking")` | `action(type: "config/animation/default", preset: "thinking")` |
| `toggle_logging()` | `action(type: "config/logging/toggle")` |
| `set_commands(commands: [...])` | `action(type: "config/commands", commands: [...])` |

### Message Operations

| v5 Tool | v6 Equivalent |
| --- | --- |
| `edit_message(message_id: 1, text: "...")` | `action(type: "message/edit", message_id: 1, text: "...")` |
| `edit_message_text(message_id: 1, text: "...")` | `action(type: "message/edit", message_id: 1, text: "...")` |
| `delete_message(message_id: 1)` | `action(type: "message/delete", message_id: 1)` |
| `pin_message(message_id: 1)` | `action(type: "message/pin", message_id: 1)` |
| `set_reaction(message_id: 1, emoji: "👍")` | `action(type: "message/react", message_id: 1, emoji: "👍")` |
| `answer_callback_query(callback_query_id: "...")` | `action(type: "message/acknowledge", callback_query_id: "...")` |
| `route_message(target_sid: 1, event: {...})` | `action(type: "message/route", target_sid: 1, event: {...})` |
| `send_chat_action(action: "typing")` | `action(type: "message/chat-action", chat_action: "typing")` |

### History

| v5 Tool | v6 Equivalent |
| --- | --- |
| `get_chat()` | `action(type: "history/chat")` |
| `get_chat_history(count: 20)` | `action(type: "history/chat", count: 20)` |
| `get_message(message_id: 1)` | `action(type: "history/message", message_id: 1)` |

### Logs (governor-only)

| v5 Tool | v6 Equivalent |
| --- | --- |
| `get_log(filename: "session.log")` | `action(type: "log/get", filename: "session.log")` |
| `list_logs()` | `action(type: "log/list")` |
| `roll_log()` | `action(type: "log/roll")` |
| `delete_log(filename: "old.log")` | `action(type: "log/delete", filename: "old.log")` |
| `get_debug_log()` | `action(type: "log/debug")` |
| `dump_session_record()` | `action(type: "log/dump")` |

### Standalone / Misc

| v5 Tool | v6 Equivalent |
| --- | --- |
| `show_typing()` | `action(type: "show-typing")` |
| `cancel_animation(text: "Done")` | `action(type: "animation/cancel", text: "Done")` |
| `approve_agent(token: 1, color: "green")` | `action(type: "approve", token: 1, color: "green")` |
| `shutdown()` | `action(type: "shutdown")` |
| `notify_shutdown_warning()` | `action(type: "shutdown/warn")` |
| `transcribe_voice(file_id: "...")` | `action(type: "transcribe", file_id: "...")` |
| `download_file(file_id: "...")` | `action(type: "download", file_id: "...")` |
| `update_checklist(message_id: 1, steps: [...])` | `action(type: "checklist/update", message_id: 1, steps: [...])` |
| `update_progress(message_id: 1, percent: 75)` | `action(type: "progress/update", message_id: 1, percent: 75)` |

### Removed / Replaced

| v5 Tool | Status | Notes |
| --- | --- | --- |
| `get_agent_guide` | Removed | Use `help(topic: "guide")` or the `telegram-bridge-mcp://agent-guide` resource |
| `get_me` | Removed | Use `action(type: "history/chat")` to verify the connection |

---

## Common Patterns (Before & After)

### Starting a session

**v5:**

```
session_start(name: "Worker 1")
```

**v6:**

```
action(type: "session/start", name: "Worker 1")
```

---

### Sending a text message

**v5:**

```
send_text(text: "Hello, operator!")
```

**v6:**

```
send(type: "text", text: "Hello, operator!")
```

---

### Sending a voice note (TTS)

**v5:**

```
send_text_as_voice(audio: "Task complete.")
```

**v6:**

```
send(type: "text", audio: "Task complete.")
```

To send both a voice note and a text caption simultaneously:

```
send(type: "text", audio: "Task complete.", text: "Task complete.")
```

---

### Asking a free-text question

**v5:**

```
ask(ask: "What branch should I use?")
```

**v6:**

```
send(type: "question", ask: "What branch should I use?")
```

---

### Presenting buttons (choose)

**v5:**

```
choose(text: "Which option?", options: [{label: "A", value: "a"}, {label: "B", value: "b"}])
```

**v6:**

```
send(type: "question", text: "Which option?", choose: [{label: "A", value: "a"}, {label: "B", value: "b"}])
```

> **Note:** The v5 `choose` tool used `question` as the prompt parameter; v6 uses `text`.

---

### Yes/No confirmation

**v5:**

```
confirm(confirm: "Are you sure?")
```

or

```
confirmYN(confirm: "Are you sure?")
```

**v6:**

```
send(type: "question", confirm: "Are you sure?")
```

---

### Sending a notification

**v5:**

```
notify(text: "Build complete", severity: "success")
```

**v6:**

```
send(type: "notification", text: "Build complete", severity: "success")
```

---

### DM between sessions

**v5:**

```
send_direct_message(target_sid: 2, text: "Task ready for pickup")
```

**v6:**

```
send(type: "direct", target_sid: 2, text: "Task ready for pickup")
```

---

### Setting a reminder

**v5:**

```
set_reminder(delay: 300, text: "Check build output")
```

**v6:**

```
action(type: "config/reminder/set", delay: 300, text: "Check build output")
```

---

### Rolling the log

**v5:**

```
roll_log()
```

**v6:**

```
action(type: "log/roll")
```

---

### Updating a progress bar

**v5:**

```
send_new_progress(title: "Build", percent: 0)
// later...
update_progress(message_id: 123, percent: 75, subtext: "Compiling...")
```

**v6:**

```
send(type: "progress", title: "Build", percent: 0)
// later...
action(type: "progress/update", message_id: 123, percent: 75, subtext: "Compiling...")
```

---

### Updating a checklist

**v5:**

```
send_new_checklist(title: "Deploy", steps: [{label: "Build", status: "pending"}, ...])
// later...
update_checklist(message_id: 123, steps: [{label: "Build", status: "done"}, ...])
```

**v6:**

```
send(type: "checklist", title: "Deploy", steps: [{label: "Build", status: "pending"}, ...])
// later...
action(type: "checklist/update", message_id: 123, steps: [{label: "Build", status: "done"}, ...])
```

---

## Progressive Discovery

The `action` tool supports incremental navigation — you don't need to memorize all 37 paths.

**Step 1:** Call with no `type` to list all top-level categories:

```
action()
```

Returns: `{ categories: ["session", "config", "message", "history", "log", "animation", "show-typing", ...] }`

**Step 2:** Pass a category to list its sub-paths:

```
action(type: "session")
```

Returns: `["session/start", "session/close", "session/list", "session/rename"]`

**Step 3:** Pass the full path to execute:

```
action(type: "session/start", name: "Worker 1")
```

This discovery pattern means you can navigate like a REST API rather than memorizing all paths upfront.

---

## Breaking Changes

1. **Tool count** — v5 registered 50+ MCP tools; v6 registers exactly 4. Any MCP client that enumerates tools will see a dramatically smaller set.

2. **`dequeue_update` renamed** — The v5 `dequeue_update` tool is gone. Use `dequeue` (same semantics; the short alias already existed in v5).

3. **Voice parameter removed** — The per-message `voice` and `speed` override parameters were removed from `ask`, `choose`, `confirm`, and `send_text`. TTS now uses session-level voice settings only. Use `action(type: "config/voice")` to set the session voice.

4. **`choose` parameter renamed** — In the old `choose` tool, the display prompt was named `question`. In v6 `send(type: "question", choose: [...])`, the prompt parameter is `text`.

5. **`confirmYN` merged** — `confirmYN` and `confirm` are now the same path: `send(type: "question", confirm: "...")`.

6. **`edit_message_text` merged** — `edit_message` and `edit_message_text` both map to `action(type: "message/edit")`.

7. **`get_me` removed** — The standalone bot identity check has no direct replacement. Use `action(type: "history/chat")` to confirm the session is alive and authenticated.

---

## Removed Tools

| Tool | Replacement |
| --- | --- |
| `get_agent_guide` | `help(topic: "guide")` or the `telegram-bridge-mcp://agent-guide` resource |
| `get_me` | `action(type: "history/chat")` — confirms connection, returns chat info |
| `edit_message_text` | `action(type: "message/edit")` — merged with `edit_message` |
| `confirmYN` | `send(type: "question", confirm: "...")` — merged with `confirm` |

---
Created: 2026-04-08
Parent: 10-404
Purpose: Release gate — verify every master-branch capability maps to v6
---

# 10-404 Test Plan — v6 API Consolidation Verification

## Purpose

Before release, every tool and parameter from the current master branch must be
verified as accessible through the consolidated v6 API. This matrix is the
release gate — nothing ships until every row is checked off.

## How to Use

1. Worker implements a consolidation group
2. Worker runs through each row in that group, confirming the old behavior works
   via the new API surface
3. Mark each row `PASS` or `FAIL` with the commit hash that verified it
4. All rows must be `PASS` before the epic can close

## Verification Matrix

### Group 1: `get_me` → `help(topic: 'identity')` — Task 10-387

| # | Old Call | v6 Equivalent | Key Params | Status |
|---|---------|---------------|------------|--------|
| 1 | `get_me()` | `help(topic: 'identity')` | (none) | ⬜ |
| 2 | `get_me()` → bot username | `help(topic: 'identity')` → bot username | verify field present | ⬜ |
| 3 | `get_me()` → server version | `help(topic: 'identity')` → server version | verify field present | ⬜ |

### Group 2: `send` + `append_text` → unified `send`

| # | Old Call | v6 Equivalent | Key Params | Status |
|---|---------|---------------|------------|--------|
| 4 | `send(token, text: "hello")` | `send(token, text: "hello")` | text only | ⬜ |
| 5 | `send(token, audio: "hello")` | `send(token, audio: "hello")` | TTS only | ⬜ |
| 6 | `send(token, text: "x", audio: "y")` | `send(token, text: "x", audio: "y")` | text + audio | ⬜ |
| 7 | `send(token, text: "x", parse_mode: "MarkdownV2")` | `send(token, text: "x", parse_mode: "MarkdownV2")` | parse_mode | ⬜ |
| 8 | `send(token, text: "x", reply_to_message_id: 123)` | `send(token, text: "x", reply_to_message_id: 123)` | reply | ⬜ |
| 9 | `send(token, text: "x", disable_notification: true)` | `send(token, text: "x", disable_notification: true)` | silent | ⬜ |
| 10 | `append_text(token, message_id: 1, text: "more")` | `send(token, message_id: 1, append: "more")` | append mode | ⬜ |
| 11 | `append_text(token, message_id: 1, text: "x", separator: " — ")` | `send(token, message_id: 1, append: "x", separator: " — ")` | custom separator | ⬜ |
| 12 | `append_text(token, message_id: 1, text: "x", parse_mode: "HTML")` | `send(token, message_id: 1, append: "x", parse_mode: "HTML")` | parse_mode on append | ⬜ |

### Group 3: `edit_message` + `edit_message_text` → `edit`

| # | Old Call | v6 Equivalent | Key Params | Status |
|---|---------|---------------|------------|--------|
| 13 | `edit_message(token, message_id: 1, text: "new")` | `edit(token, message_id: 1, text: "new")` | text edit | ⬜ |
| 14 | `edit_message(token, message_id: 1, keyboard: [...])` | `edit(token, message_id: 1, keyboard: [...])` | keyboard edit | ⬜ |
| 15 | `edit_message(token, message_id: 1, text: "new", keyboard: [...])` | `edit(token, message_id: 1, text: "new", keyboard: [...])` | both | ⬜ |
| 16 | `edit_message(token, message_id: 1, keyboard: null)` | `edit(token, message_id: 1, keyboard: null)` | remove keyboard | ⬜ |
| 17 | `edit_message(token, ..., parse_mode: "MarkdownV2")` | `edit(token, ..., parse_mode: "MarkdownV2")` | parse_mode | ⬜ |
| 18 | `edit_message_text(token, message_id: 1, text: "new")` | `edit(token, message_id: 1, text: "new")` | legacy text edit | ⬜ |
| 19 | `edit_message_text(token, ..., reply_markup: {...})` | `edit(token, ..., keyboard: [...])` | legacy reply_markup | ⬜ |

### Group 4: Animation → `animation`

| # | Old Call | v6 Equivalent | Key Params | Status |
|---|---------|---------------|------------|--------|
| 20 | `show_animation(token, preset: "working")` | `animation(token, command: "show", preset: "working")` | preset | ⬜ |
| 21 | `show_animation(token, frames: [...])` | `animation(token, command: "show", frames: [...])` | custom frames | ⬜ |
| 22 | `show_animation(token, interval: 2000)` | `animation(token, command: "show", interval: 2000)` | interval | ⬜ |
| 23 | `show_animation(token, timeout: 120)` | `animation(token, command: "show", timeout: 120)` | timeout | ⬜ |
| 24 | `show_animation(token, persistent: true)` | `animation(token, command: "show", persistent: true)` | persistent | ⬜ |
| 25 | `show_animation(token, notify: true)` | `animation(token, command: "show", notify: true)` | notify | ⬜ |
| 26 | `show_animation(token, priority: 5)` | `animation(token, command: "show", priority: 5)` | priority | ⬜ |
| 27 | `show_animation(token, allow_breaking_spaces: true)` | `animation(token, command: "show", allow_breaking_spaces: true)` | spacing | ⬜ |
| 28 | `cancel_animation(token)` | `animation(token, command: "cancel")` | basic cancel | ⬜ |
| 29 | `cancel_animation(token, text: "Done!")` | `animation(token, command: "cancel", text: "Done!")` | cancel with text | ⬜ |
| 30 | `cancel_animation(token, parse_mode: "MarkdownV2")` | `animation(token, command: "cancel", parse_mode: "MarkdownV2")` | cancel parse_mode | ⬜ |
| 31 | `set_default_animation(token, frames: [...])` | `animation(token, command: "set_default", frames: [...])` | set frames | ⬜ |
| 32 | `set_default_animation(token, name: "preset")` | `animation(token, command: "set_default", name: "preset")` | named preset | ⬜ |
| 33 | `set_default_animation(token, reset: true)` | `animation(token, command: "set_default", reset: true)` | reset | ⬜ |

### Group 5: Checklist + Progress → `tool`

| # | Old Call | v6 Equivalent | Key Params | Status |
|---|---------|---------------|------------|--------|
| 34 | `send_new_progress(token, percent: 50)` | `tool(token, type: "progress", action: "new", percent: 50)` | new progress | ⬜ |
| 35 | `send_new_progress(token, percent: 0, title: "Build")` | `tool(token, type: "progress", action: "new", percent: 0, title: "Build")` | title | ⬜ |
| 36 | `send_new_progress(token, ..., subtext: "compiling")` | `tool(token, type: "progress", action: "new", ..., subtext: "compiling")` | subtext | ⬜ |
| 37 | `send_new_progress(token, ..., width: 20)` | `tool(token, type: "progress", action: "new", ..., width: 20)` | width | ⬜ |
| 38 | `update_progress(token, message_id: 1, percent: 80)` | `tool(token, type: "progress", action: "update", message_id: 1, percent: 80)` | update | ⬜ |
| 39 | `update_progress(token, ..., title/subtext/width)` | `tool(token, type: "progress", action: "update", ..., title/subtext/width)` | update all fields | ⬜ |
| 40 | `send_new_checklist(token, title: "T", steps: [...])` | `tool(token, type: "checklist", action: "new", title: "T", steps: [...])` | new checklist | ⬜ |
| 41 | `update_checklist(token, message_id: 1, title: "T", steps: [...])` | `tool(token, type: "checklist", action: "update", message_id: 1, title: "T", steps: [...])` | update checklist | ⬜ |

### Group 6: Log → `log` (governor only)

| # | Old Call | v6 Equivalent | Key Params | Status |
|---|---------|---------------|------------|--------|
| 42 | `get_log(token)` | `log(token, action: "get")` | read current log | ⬜ |
| 43 | `get_log(token, filename: "x.log")` | `log(token, action: "get", filename: "x.log")` | read specific log | ⬜ |
| 44 | `list_logs(token)` | `log(token, action: "list")` | list logs | ⬜ |
| 45 | `delete_log(token, filename: "x.log")` | `log(token, action: "delete", filename: "x.log")` | delete log | ⬜ |
| 46 | `toggle_logging(token, enabled: true)` | `log(token, action: "toggle", enabled: true)` | enable | ⬜ |
| 47 | `toggle_logging(token, enabled: false)` | `log(token, action: "toggle", enabled: false)` | disable | ⬜ |
| 48 | `roll_log(token)` | `log(token, action: "roll")` | archive + new | ⬜ |
| 49 | `get_debug_log(token)` | `log(token, action: "debug")` | debug trace | ⬜ |
| 50 | `get_debug_log(token, count: 100)` | `log(token, action: "debug", count: 100)` | limited count | ⬜ |
| 51 | `get_debug_log(token, category: "...")` | `log(token, action: "debug", category: "...")` | filtered | ⬜ |
| 52 | `get_debug_log(token, since: 12345)` | `log(token, action: "debug", since: 12345)` | since timestamp | ⬜ |
| 53 | `get_debug_log(token, enable: true)` | `log(token, action: "debug", enable: true)` | enable debug | ⬜ |
| 54 | `dump_session_record(token)` | `log(token, action: "roll")` | backward compat alias | ⬜ |

### Group 7: Profile → `profile`

| # | Old Call | v6 Equivalent | Key Params | Status |
|---|---------|---------------|------------|--------|
| 55 | `save_profile(token, key: "Curator")` | `profile(token, action: "save", key: "Curator")` | save | ⬜ |
| 56 | `load_profile(token, key: "Curator")` | `profile(token, action: "load", key: "Curator")` | load | ⬜ |
| 57 | `import_profile(token, voice: "am_onyx")` | `profile(token, action: "import", voice: "am_onyx")` | import single | ⬜ |
| 58 | `import_profile(token, voice: "x", voice_speed: 1.1, animation_default: [...], animation_presets: {...}, reminders: [...])` | `profile(token, action: "import", voice: "x", voice_speed: 1.1, animation_default: [...], animation_presets: {...}, reminders: [...])` | import all fields | ⬜ |

### Group 8: Reminder → `reminder`

| # | Old Call | v6 Equivalent | Key Params | Status |
|---|---------|---------------|------------|--------|
| 59 | `set_reminder(token, text: "check", delay_seconds: 600)` | `reminder(token, action: "set", text: "check", delay_seconds: 600)` | timed | ⬜ |
| 60 | `set_reminder(token, text: "x", trigger: "startup")` | `reminder(token, action: "set", text: "x", trigger: "startup")` | startup trigger | ⬜ |
| 61 | `set_reminder(token, text: "x", recurring: true)` | `reminder(token, action: "set", text: "x", recurring: true)` | recurring | ⬜ |
| 62 | `set_reminder(token, text: "x", id: "my-rem")` | `reminder(token, action: "set", text: "x", id: "my-rem")` | named | ⬜ |
| 63 | `cancel_reminder(token, id: "my-rem")` | `reminder(token, action: "cancel", id: "my-rem")` | cancel | ⬜ |
| 64 | `list_reminders(token)` | `reminder(token, action: "list")` | list all | ⬜ |

### Group 9: Session → `session`

| # | Old Call | v6 Equivalent | Key Params | Status |
|---|---------|---------------|------------|--------|
| 65 | `session_start(name: "Curator")` | `session(action: "start", name: "Curator")` | basic start | ⬜ |
| 66 | `session_start(name: "X", color: "🟦")` | `session(action: "start", name: "X", color: "🟦")` | with color | ⬜ |
| 67 | `session_start(name: "X", reconnect: true)` | `session(action: "start", name: "X", reconnect: true)` | reconnect | ⬜ |
| 68 | `close_session(token)` | `session(token, action: "close")` | close | ⬜ |
| 69 | `list_sessions(token)` | `session(token, action: "list")` | list | ⬜ |
| 70 | `rename_session(token, new_name: "Y")` | `session(token, action: "rename", new_name: "Y")` | rename | ⬜ |

## Unchanged Tools — Smoke Tests

These tools keep their current names. Each needs a basic smoke test to confirm
nothing regressed during the consolidation refactor.

| # | Tool | Smoke Test | Status |
|---|------|-----------|--------|
| 71 | `help()` | Returns overview | ⬜ |
| 72 | `help(topic: 'identity')` | Returns bot info (was `get_me`) | ⬜ |
| 73 | `dequeue(token)` | Returns queued events | ⬜ |
| 74 | `notify(token, title: "test")` | Sends notification | ⬜ |
| 75 | `ask(token, question: "test")` | Sends and waits | ⬜ |
| 76 | `choose(token, text: "pick", options: [...])` | Sends buttons, waits | ⬜ |
| 77 | `confirm(token, text: "ok?", ...)` | Sends yes/no, waits | ⬜ |
| 78 | `send_choice(token, text: "x", options: [...])` | Non-blocking buttons | ⬜ |
| 79 | `send_file(token, file: "...")` | Sends file | ⬜ |
| 80 | `delete_message(token, message_id: 1)` | Deletes message | ⬜ |
| 81 | `get_message(token, message_id: 1)` | Retrieves message | ⬜ |
| 82 | `get_chat_history(token, count: 5)` | Returns history | ⬜ |
| 83 | `answer_callback_query(token, callback_query_id: "x")` | Answers callback | ⬜ |
| 84 | `set_reaction(token, message_id: 1, emoji: "👍")` | Sets reaction | ⬜ |
| 85 | `pin_message(token, message_id: 1)` | Pins message | ⬜ |
| 86 | `download_file(token, file_id: "x")` | Downloads file | ⬜ |
| 87 | `transcribe_voice(token, file_id: "x")` | Transcribes voice | ⬜ |
| 88 | `set_commands(token, commands: [...])` | Sets bot commands | ⬜ |
| 89 | `set_topic(token, topic: "test")` | Sets topic | ⬜ |
| 90 | `set_voice(token, voice: "am_onyx")` | Sets TTS voice | ⬜ |
| 91 | `show_typing(token)` | Shows typing indicator | ⬜ |
| 92 | `send_chat_action(token, action: "typing")` | One-shot action | ⬜ |
| 93 | `send_direct_message(token, target_sid: 2, text: "hi")` | DM to session | ⬜ |
| 94 | `route_message(token, message_id: 1, target_sid: 2)` | Routes message | ⬜ |
| 95 | `approve_agent(token, target_name: "Worker")` | Approves session | ⬜ |
| 96 | `shutdown()` | Graceful shutdown | ⬜ |
| 97 | `notify_shutdown_warning(token)` | Pre-shutdown advisory | ⬜ |
| 98 | `set_dequeue_default(token, timeout: 60)` | Sets default timeout | ⬜ |
| 99 | `get_chat(token)` | Returns chat info | ⬜ |

## Summary

- **Consolidated tool tests:** 70 rows (groups 1–9)
- **Unchanged smoke tests:** 29 rows
- **Total:** 99 verification rows
- **Release gate:** All rows must be `PASS`

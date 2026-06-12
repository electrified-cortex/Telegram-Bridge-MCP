---
Created: 2026-04-08
Updated: 2026-04-08
Status: Draft
Host: local
Priority: 10-404
Source: Operator (voice msgs 28230, 28337–28397)
---

# v6 API Consolidation — 4-Tool Architecture

## Objective

Consolidate the Telegram MCP toolset from 57 tools down to **4** using a
RESTful-style path routing pattern. The API should be "stupid clean" — agents
learn 3 tools to function, everything else is discoverable through progressive
hints.

## The 4 Tools

| # | Tool | Purpose | Usage Frequency |
| --- | --- | --- | --- |
| 1 | `send` | Emit anything | ~90% of calls |
| 2 | `dequeue` | Receive messages | ~90% of calls |
| 3 | `help` | Discover API | on-demand |
| 4 | `action` | Everything else | ~10% of calls |

### Design Philosophy

- **`send` + `dequeue`** = the chat loop. 99% of agent work is sending and
  receiving. These are the only two tools an agent truly needs.
- **`help`** = self-documenting discovery. Appears as hints in tool responses.
  Agents don't need to know about `help` in advance — responses suggest it.
- **`action`** = universal verb for everything else. Uses `type` as a
  RESTful-style path to route operations. Rare operations, configuration,
  session management, history lookup — all live here.

## Design Principles

1. **RESTful path routing.** The `type` parameter reads like a path:
   `action(type: "message/edit")`, `action(type: "config/voice")`. The first
   segment is the category, subsequent segments narrow the operation.

2. **Progressive discovery.** Three tiers of self-documentation:
   - `action()` with no params → lists all action categories
   - `action(type: "config")` → lists all config sub-paths
   - `help(topic: "action")` → full detailed docs
   Each tier hints at the next.

3. **Type vs Action in `send`.** The `type` param in `send` tells you WHAT
   you're sending: text, file, question, animation, checklist, etc.

4. **No functionality loss.** Every v5 capability must remain accessible.
   This is a remap, not a reduction.

5. **Minimize surface area.** Every new MCP tool costs context budget. 4 tools
   is the absolute minimum that preserves usability.

## Tool 1 — `send`

All message emission flows through `send`. The `type` param distinguishes
what you're sending.

### Send Types

| Type | Replaces | Description |
| --- | --- | --- |
| `text` (default) | `send` | Standard text message |
| `file` | `send_file` | File upload |
| `notification` | `notify` | Notification banner |
| `choice` | `send_choice` | Inline button selection |
| `direct` | `send_direct_message` | DM to another session |
| `append` | `append_text` | Append to existing message |
| `animation` | `show_animation` | Show animation |
| `checklist` | `send_new_checklist` | New checklist |
| `progress` | `send_new_progress` | New progress bar |
| `question` | `ask` + `choose` + `confirm` | Questions (sub-typed) |

### Question Sub-Types

| Sub-Type | Replaces | Description |
| --- | --- | --- |
| `ask` | `ask` | Free-text prompt |
| `choose` | `choose` | Multi-option selection |
| `confirm` | `confirm` | Yes/no confirmation |

Examples:

```
send(text: "Hello")                              → plain message
send(type: "file", path: "report.pdf")           → file upload
send(type: "notification", title: "Done", ...)   → banner
send(type: "choice", options: [...])             → choice buttons
send(type: "direct", to: 2, text: "Status?")    → DM worker
send(type: "append", message_id: 123, text: "…") → append
send(type: "animation", preset: "working")       → animation
send(type: "checklist", items: [...])            → new checklist
send(type: "progress", label: "Build", width: 10) → progress bar
send(type: "question", ask: "What name?")        → ask prompt
send(type: "question", choose: [...])            → choice prompt
send(type: "question", confirm: "Delete?")       → yes/no prompt
```

### Send with No Params

`send()` → emits brief usage summary + hint to `help(topic: "send")`.

## Tool 2 — `dequeue`

Renamed from `dequeue_update`. Drains the message queue. No changes to
behavior — name simplified.

## Tool 3 — `help`

Self-documenting discovery tool. Already supports `topic` param for specific
subjects (e.g., `help(topic: "identity")` from 10-387).

Extended for v6:

- `help()` → overview of all 4 tools + getting started
- `help(topic: "send")` → all send types with examples
- `help(topic: "action")` → all action categories and paths
- `help(topic: "identity")` → bot identity (from get_me)

### Hint Pattern

Every tool response includes a contextual `help` hint at the bottom:

- When caller uses default (no type/params) → stronger hint, agent is exploring
- When caller specifies type explicitly → lighter hint or none, agent knows what
  they're doing

## Tool 4 — `action`

Universal verb for everything that isn't send/dequeue/help. Uses `type` as a
RESTful-style path to route operations.

### Action Categories

#### `message/*` — Message Operations

| Path | Replaces | Description |
| --- | --- | --- |
| `message/edit` | `edit_message` + `edit_message_text` | Edit existing message |
| `message/delete` | `delete_message` | Delete a message |
| `message/pin` | `pin_message` | Pin a message |
| `message/react` | `set_reaction` | React to a message |
| `message/acknowledge` | `answer_callback_query` | Acknowledge callback query |
| `message/route` | `route_message` | Route to another session |

#### `config/*` — Configuration

| Path | Replaces | Description |
| --- | --- | --- |
| `config/voice` | `set_voice` | Get/set voice (jQuery-style) |
| `config/topic` | `set_topic` | Get/set topic (jQuery-style) |
| `config/profile/save` | `save_profile` | Save profile |
| `config/profile/load` | `load_profile` | Load profile |
| `config/profile/import` | `import_profile` | Import profile |
| `config/reminder/set` | `set_reminder` | Set reminder |
| `config/reminder/cancel` | `cancel_reminder` | Cancel reminder |
| `config/reminder/list` | `list_reminders` | List reminders |
| `config/dequeue-default` | `set_dequeue_default` | Configure dequeue timeout |
| `config/animation/default` | `set_default_animation` | Set default animation |
| `config/logging/toggle` | `toggle_logging` | Toggle logging |

#### `session/*` — Session Lifecycle

| Path | Replaces | Description |
| --- | --- | --- |
| `session/start` | `session_start` | Start new session |
| `session/close` | `close_session` | Close session |
| `session/list` | `list_sessions` | List active sessions |
| `session/rename` | `rename_session` | Rename session |

#### `history/*` — Data Retrieval

| Path | Replaces | Description |
| --- | --- | --- |
| `history/chat` | `get_chat_history` + `get_chat` | Chat history / info |
| `history/message` | `get_message` | Single message lookup |

#### `log/*` — Event Log (governor-only)

| Path | Replaces | Description |
| --- | --- | --- |
| `log/get` | `get_log` | Get log content |
| `log/list` | `list_logs` | List log files |
| `log/roll` | `roll_log` | Roll current log |
| `log/delete` | `delete_log` | Delete a log |
| `log/debug` | `get_debug_log` | Get debug log |
| `log/dump` | `dump_session_record` | Dump session record |

#### `animation/*` — Animation Control

| Path | Replaces | Description |
| --- | --- | --- |
| `animation/cancel` | `cancel_animation` | Cancel running animation |

Note: `animation/show` unnecessary — use `send(type: "animation")` instead.
`animation/set-default` moved to `config/animation/default`.

#### Standalone Actions

| Path | Replaces | Description |
| --- | --- | --- |
| `show-typing` | `show_typing` + `send_chat_action` | Show typing indicator |
| `approve` | `approve_agent` | Approve pending agent |
| `shutdown` | `shutdown` | Execute shutdown |
| `shutdown/warn` | `notify_shutdown_warning` | Warn all sessions |
| `transcribe` | `transcribe_voice` | Transcribe voice message |
| `download` | `download_file` | Download a file |
| `checklist/update` | `update_checklist` | Update existing checklist |
| `progress/update` | `update_progress` | Update existing progress |

### Action with No Params

`action()` → emits a category summary:

```
Available action categories:
  message/*    — edit, delete, pin, react, acknowledge, route
  config/*     — voice, topic, profile, reminder, logging, animation
  session/*    — start, close, list, rename
  history/*    — chat, message
  log/*        — get, list, roll, delete, debug, dump (governor)
  animation/*  — cancel
  + show-typing, approve, shutdown, transcribe, download, checklist/update, progress/update

💡 help(topic: "action") for full details
```

### Auth Levels

| Level | Action Paths |
| --- | --- |
| **governor** | `log/*`, `approve`, `shutdown/*`, `message/route` |
| **session** | everything else |

## Eliminated / Absorbed Tools — Complete Map

All 57 v5 tools mapped to their v6 equivalent:

| v5 Tool | v6 Tool | v6 Path / Type |
| --- | --- | --- |
| `answer_callback_query` | `action` | `message/acknowledge` |
| `append_text` | `send` | `type: "append"` |
| `approve_agent` | `action` | `approve` |
| `ask` | `send` | `type: "question", ask: "..."` |
| `cancel_animation` | `action` | `animation/cancel` |
| `cancel_reminder` | `action` | `config/reminder/cancel` |
| `choose` | `send` | `type: "question", choose: [...]` |
| `close_session` | `action` | `session/close` |
| `confirm` | `send` | `type: "question", confirm: "..."` |
| `delete_log` | `action` | `log/delete` |
| `delete_message` | `action` | `message/delete` |
| `dequeue_update` | `dequeue` | (renamed) |
| `download_file` | `action` | `download` |
| `dump_session_record` | `action` | `log/dump` |
| `edit_message` | `action` | `message/edit` |
| `edit_message_text` | `action` | `message/edit` |
| `get_chat` | `action` | `history/chat` |
| `get_chat_history` | `action` | `history/chat` |
| `get_debug_log` | `action` | `log/debug` |
| `get_log` | `action` | `log/get` |
| `get_me` | `help` | `topic: "identity"` |
| `get_message` | `action` | `history/message` |
| `import_profile` | `action` | `config/profile/import` |
| `list_logs` | `action` | `log/list` |
| `list_reminders` | `action` | `config/reminder/list` |
| `list_sessions` | `action` | `session/list` |
| `load_profile` | `action` | `config/profile/load` |
| `notify` | `send` | `type: "notification"` |
| `notify_shutdown_warning` | `action` | `shutdown/warn` |
| `pin_message` | `action` | `message/pin` |
| `rename_session` | `action` | `session/rename` |
| `roll_log` | `action` | `log/roll` |
| `route_message` | `action` | `message/route` |
| `save_profile` | `action` | `config/profile/save` |
| `send` | `send` | `type: "text"` (default) |
| `send_chat_action` | `action` | `show-typing` |
| `send_choice` | `send` | `type: "choice"` |
| `send_direct_message` | `send` | `type: "direct"` |
| `send_file` | `send` | `type: "file"` |
| `send_new_checklist` | `send` | `type: "checklist"` |
| `send_new_progress` | `send` | `type: "progress"` |
| `session_start` | `action` | `session/start` |
| `set_commands` | — | **parked/deprecated** |
| `set_dequeue_default` | `action` | `config/dequeue-default` |
| `set_default_animation` | `action` | `config/animation/default` |
| `set_reaction` | `action` | `message/react` |
| `set_reminder` | `action` | `config/reminder/set` |
| `set_topic` | `action` | `config/topic` |
| `set_voice` | `action` | `config/voice` |
| `show_animation` | `send` | `type: "animation"` |
| `show_typing` | `action` | `show-typing` |
| `toggle_logging` | `action` | `config/logging/toggle` |
| `transcribe_voice` | `action` | `transcribe` |
| `update_checklist` | `action` | `checklist/update` |
| `update_progress` | `action` | `progress/update` |

## Tool Count

| | Count |
| --- | --- |
| v5 registered tools | 57 |
| **v6 total tools** | **4** |
| Reduction | 93% |
| Parked/deprecated | 1 (`set_commands`) |

## Design Evolution

This design evolved through three phases in a single session:

1. **Phase A (msgs 28230–28337):** Initial proposal — 35→15 tools, category
   grouping with action params.
2. **Phase B (msgs 28337–28375):** Refined to 24 tools — jQuery-style
   getter/setter, `send` super-tool, `tool` catch-all, type vs action
   distinction.
3. **Phase C (msgs 28378–28397):** Breakthrough — 4-tool architecture with
   RESTful path routing. "Send, dequeue, help, action — this is the way."

Key insight: agents only need `send` + `dequeue` to function. Everything else
is discoverable through progressive hints. The `action` tool with path-style
`type` routing provides a clean, extensible surface for all non-core operations.

## Implementation Strategy

This is a **major breaking change** — the entire tool surface is being replaced.

### Phase 1 — Foundation

- [ ] Implement `action` tool with path router and category discovery
- [ ] Implement progressive discovery (no-param → category list → help hint)
- [ ] Design path resolution and parameter forwarding infrastructure

### Phase 2 — `send` Expansion

- [ ] Add `type` routing to `send` (text, file, notification, choice, direct, append)
- [ ] Add `type: "animation"` (absorbs `show_animation`)
- [ ] Add `type: "checklist"` and `type: "progress"` (absorbs new-checklist/progress)
- [ ] Add `type: "question"` with sub-types (absorbs ask, choose, confirm)

### Phase 3 — `action` Categories

- [ ] `message/*` — edit, delete, pin, react, acknowledge, route
- [ ] `config/*` — voice, topic, profile, reminder, dequeue-default, animation-default, logging
- [ ] `session/*` — start, close, list, rename
- [ ] `history/*` — chat, message
- [ ] `log/*` — get, list, roll, delete, debug, dump (governor auth gate)
- [ ] Standalone actions — show-typing, approve, shutdown, transcribe, download
- [ ] `checklist/update` and `progress/update`

### Phase 4 — Removal

- [ ] Remove all 53 replaced tool registrations
- [ ] Remove `set_commands` (parked)
- [ ] Update `dequeue_update` → `dequeue` (rename)

### Phase 5 — Documentation

- [ ] Update help.ts with 4-tool landscape + progressive discovery content
- [ ] Update all agent instructions and skills referencing old tool names
- [ ] Update docs (behavior.md, setup.md, API reference)
- [ ] Update changelog
- [x] 10-387: `get_me` → `help(topic: 'identity')` *(completed)*

## Absolute Constraint

**No functionality loss.** Every capability exposed by the 57 v5 tools must
remain accessible through the 4 v6 tools. This is a remap, not a reduction.
Every parameter, every mode, every edge case — it all carries over.

## Acceptance Criteria

- [ ] All 4 tools work with full type/path routing
- [ ] All 57 v5 capabilities are accessible through v6
- [ ] Progressive discovery works at all 3 tiers
- [ ] Agent instructions updated to use new patterns
- [ ] help.ts reflects 4-tool architecture
- [ ] changelog documents the complete remap
- [ ] Build, lint, and all tests pass
- [ ] No backward-compatible aliases (clean break for v6)

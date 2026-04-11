# Super Tools

> Super tools are high-level Telegram primitives that manage their own message lifecycle —
> they auto-pin themselves when created, update in-place, and auto-unpin when complete.
> They spare the agent from writing pin/edit/unpin boilerplate by handling it internally.

---

## Concept

Standard tools like `send(type: "text")` and `send(type: "notification")` fire-and-forget.
Super tools instead maintain a **persistent, mutable presence** in the chat:

1. **Create** — sends the message, pins it (silent), returns `message_id`
2. **Update** — agent edits in-place by passing `message_id`; pinned message stays visible
3. **Complete** — tool auto-unpins when done so the chat stays clean

---

## Super Tools

### Checklist — `send(type: "checklist", ...)`

A live task checklist with per-step status indicators.
Implemented as of v3 (renamed from `update_status`).

**Status values:** `pending` · `running` · `done` · `failed` · `skipped`

**API (two-tool pattern):**

```text
# Create — auto-pins the message (silent)
{ message_id } = send(type: "checklist", title, steps)

# Update (in-place edit — requires message_id from send)
# Auto-unpins when all steps reach terminal status (done/failed/skipped)
action(type: "checklist/update", message_id, title, steps)
```

---

### Progress Bar — `send(type: "progress", ...)` + `action(type: "progress/update", ...)`

A visual progress bar rendered with emoji blocks.
Implemented as two calls: `send(type: "progress", ...)` (create, auto-pins) and `action(type: "progress/update", ...)` (edit in-place, auto-unpins at 100%).

**Example:**

```text
# Create — auto-pins the message (silent)
{ message_id } = send(type: "progress", title, percent, subtext?)

# Built-in render (50%, default width 10):
# ▓▓▓▓▓░░░░░  50%
# Building dist/...

# Update in-place — auto-unpins when percent reaches 100
action(type: "progress/update", message_id, title, percent: 100, subtext: "Done in 4.2s")
```

**Parameters:**

| Parameter | Type | Notes |
| --- | --- | --- |
| `title` | string | Bold heading |
| `percent` | 0–100 | Current progress |
| `subtext` | string (optional) | Italicized detail line below the bar |
| `width` | number (optional) | Bar width in chars; default 10, max 40 |
| `message_id` | number | Required for `action(type: "progress/update", ...)`; pass the value returned by `send(type: "progress", ...)` |

Multiple concurrent progress bars are supported — each is tracked by its own `message_id`.
The server is stateless; all parameters must be passed on every `action(type: "progress/update", ...)` call.

---

## Design Principles

- **Auto-pin on create** — super tools are important enough to stay visible; no separate
  `action(type: "message/pin")` call required
- **Auto-unpin on complete** — unpins when done so the chat stays clean
- **In-place editing** — one message evolves rather than a stream of status messages
- **Two-call API** — each super tool is a two-call pair (`send(type: "...", ...)` to create, `action(type: ".../update", ...)` to edit in-place); `message_id` links them
- **Agent-transparent** — agent passes `message_id` around; the tool handles pin state internally

---

## Temporary Reactions

Use `action(type: "react", temporary: true, restore_emoji: "...", timeout_seconds: N)` for temporary reactions.

Set a reaction that **auto-reverts** either on the next outbound action or after a timeout, whichever comes first.

**Example:**

```text
# "I'm reading this" — reverts to 🫡 on first outbound action or after 300s
action(type: "react", message_id: msg_id, emoji: "👀", temporary: true, restore_emoji: "🫡", timeout_seconds: 300)

# Temporary ack with no follow-up — removed after 30s or on next outbound
action(type: "react", message_id: msg_id, emoji: "👍", temporary: true, timeout_seconds: 30)
```

**Parameters for temporary reactions:**

| Parameter | Notes |
| --- | --- |
| `temporary: true` | Required to enable auto-revert behavior |
| `restore_emoji` | Emoji to set after revert; omit to remove the reaction entirely |
| `timeout_seconds` | Fallback deadline; reaction reverts on whichever comes first (outbound action or timeout) |

---

## See Also

- [`docs/keyboard-interactions.md`](keyboard-interactions.md) — keyboard primitive taxonomy
- [`docs/communication.md`](communication.md) — when to use `send(type: "checklist", ...)`
- [`src/tools/send_new_checklist.ts`](../src/tools/send_new_checklist.ts) — implementation (`send(type: "checklist", ...)` + `action(type: "checklist/update", ...)`)

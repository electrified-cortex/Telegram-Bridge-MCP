# Keyboard Interaction Taxonomy

This document defines the keyboard interaction vocabulary for the Telegram Bridge MCP.
Understanding the hierarchy prevents choosing the wrong tool and guides future API design.

---

## The Four Primitives

| Tool | Blocking? | Auto-lock? | Description |
| --- | --- | --- | --- |
| `send_message(keyboard?)` | No | No | Fire & stream — buttons persist until explicitly removed |
| `send_choice(options)` | No | Yes | Fire & one-shot — auto-locks on first press |
| `choose(options)` | Yes | Yes | Send + wait + return value |
| `confirm(...)` | Yes | Yes | `choose` specialised for yes/no |

### Key insight: `send` vs `choose`

- **`send_`** means *"I'm giving you a message\_id and moving on."* The agent does not wait.
- **`choose`** means *"I need your answer before I continue."* The tool blocks until the user presses.

Auto-lock ("one-shot") means the first button press removes the keyboard and dismisses the
spinner. Subsequent presses are ignored.

---

## How the primitives compose

```text
send_message(keyboard?)         ← Level 1 — raw send, no wait, no lock
  └── send_choice(options)      ← Level 2 — raw send + auto-lock on first press
        └── choose(options)     ← Level 3 — send_choice + internal wait + return value
              └── confirm            ← Level 4 — choose specialised for yes/no
```

`choose` is essentially `send_choice` + a blocking `dequeue` loop that waits for
the specific message's callback\_query and returns the result.

---

## When to use each tool

### `send_message` with `keyboard`

Use when button presses are **ongoing events** the agent reacts to over time — not a one-time
decision that completes a workflow step.

Examples:

- A media player with ⏮ ⏸ ⏭ controls
- A live dashboard with "Refresh" and "Export" buttons
- A longrunning task with a "Cancel" button

The agent handles each press via `dequeue` → `answer_callback_query` → act.
Buttons stay visible until the agent explicitly removes them with `edit_message`.

### `send_choice`

Use when the agent **sends a prompt and continues doing other work**, but the first button
press should cleanly lock (remove buttons, dismiss spinner) regardless of when the agent
gets around to reading `dequeue`.

The callback\_query event still flows normally through `dequeue`.

Examples:

- "Do you like this song?" attached to an audio file — agent sends and moves on
- An async feedback prompt embedded in a notification
- A non-blocking decision where the agent continues working while waiting

### `choose`

Use when **the answer is required to proceed**. The tool call does not return until the user
presses a button or the timeout fires. The message is auto-edited to show the chosen option.

Examples:

- "Deploy to production?" before any deployment logic runs
- Multi-step questionnaires where each answer determines the next question
- Any point where branching logic depends on user input

### `confirm`

A specialised `choose` for exactly two options (yes/no, proceed/cancel). Use it instead of
`choose` when the choice is binary — the description is clearer and the layout is consistent.

---

## Button types

The current tools support **momentary** buttons only. Future button types are planned.

| Type | Behaviour | Status |
| --- | --- | --- |
| Momentary | Press fires a callback\_query; no persistent state | Implemented |
| Toggle | Two states (on/off); agent manages state via `edit_message` | Planned |
| Rotary | N states, cycles on each press; agent manages via `edit_message` | Planned |

For toggle and rotary behaviour today, the agent can simulate it:

1. Send with `send_message(keyboard)`.
2. On each callback\_query: call `answer_callback_query`, then `edit_message` with updated
   button labels to reflect the new state.

---

## Implementation notes

### Auto-lock mechanism (`send_choice`)

When `send_choice` sends a message, it calls `registerCallbackHook(messageId, fn)` in
`message-store.ts`. When the first `callback_query` for that `message_id` arrives in the
poller, the hook fires **before the event is enqueued**:

1. `answerCallbackQuery(qid)` — dismisses the Telegram spinner.
2. `editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] })` — removes buttons.

The event is still enqueued normally so `dequeue` sees it.

The hook is one-shot: it removes itself from the registry before calling, preventing
re-entry.

### Shared send logic

`choose` and `send_choice` both use `sendChoiceMessage()` from `button-helpers.ts` for the
actual Telegram API call. The row-building, markdown resolution, and topic application are
shared. The two tools diverge **after** the send:

- `send_choice` registers the auto-lock hook and returns.
- `choose` polls, edits the message to show the selection, and returns the result.

---

## Manual Keyboard Removal

`answer_callback_query` alone only dismisses the Telegram spinner — it does **not** remove
the inline keyboard from the message. A separate `editMessageReplyMarkup` call is required to
clear the buttons.

### Combined ack + removal (Approach B)

When handling a manual keyboard flow (e.g. a media-player control loop via `dequeue` →
`answer_callback_query`), pass `remove_keyboard: true` and `message_id: <id>` to collapse both
operations into a single tool call:

```
answer_callback_query(
  callback_query_id: qid,
  remove_keyboard: true,
  message_id: 42,
  token: ...,
)
```

This calls `answerCallbackQuery` first, then `editMessageReplyMarkup(chatId, 42, { inline_keyboard: [] })`.
The ack always succeeds even if the edit fails (failures are logged to stderr as a warning).

`message_id` is required when `remove_keyboard: true` — omitting it returns a
`MISSING_MESSAGE_ID` error before any Telegram API call is made.

### Multi-press flows (toggle / rotary)

For toggle or rotary patterns where the keyboard should stay visible and update between
presses, do **not** use `remove_keyboard`. Instead:

1. Call `answer_callback_query` alone to dismiss the spinner.
2. Call `edit_message` (or `action(type: "message/edit")`) with the updated keyboard to
   reflect the new state.

---

## See also

- `docs/communication.md` — Telegram communication patterns and reaction lifecycle
- `src/tools/button-helpers.ts` — shared row-build and send helpers
- `src/tools/send_choice.ts` — non-blocking one-shot implementation
- `src/tools/choose.ts` — blocking single-selection implementation
- `src/message-store.ts` — `registerCallbackHook` / `clearCallbackHook`

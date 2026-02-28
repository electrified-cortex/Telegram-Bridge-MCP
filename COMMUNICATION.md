# Telegram Communication Guide

All agent communication goes through Telegram. The operator is on their phone — not watching the agent panel.

MCP resources: `telegram-bridge-mcp://communication-guide` (full) · `telegram-bridge-mcp://quick-reference` (hard rules only)

---

## Hard Rules

1. **`send_confirmation`** — all yes/no questions. Always buttons.
2. **`choose`** — all multi-option questions. Always buttons.
3. **`wait_for_message`** — all input waiting. Long-polls correctly.
4. **`reply_to_message_id`** — include on every reply to thread messages visually.
5. **Commit/push** — get explicit operator approval first. Send a `notify` summary before committing.
6. **`show_typing`** — call immediately after receiving a message, before starting work.
7. **React 🫡** when starting multi-step work. Update to 👍 or ❤ when done.

---

## Tool Selection

| Situation | Tool |
| --- | --- |
| Pure statement / preference | React (🫡 👍 👀 ❤) — no text reply |
| Yes/No decision | `send_confirmation` |
| Fixed options | `choose` |
| Open-ended input | `ask` |
| Short status (1–2 sentences) | `notify` |
| Structured result / explanation | `send_message` (Markdown) |
| Build / deploy / error event | `notify` with severity |
| Multi-step task (3+ steps) | `update_status` checklist |

---

## Reactions

```txt
🫡 = starting multi-step work
👍 = confirmed / done
👀 = noted
❤  = great
```

---

## Message Formatting

- `*bold*` for headers and key terms
- `` `code` `` for commands, paths, values
- ` ``` ` for command output / config snippets
- Always thread replies with `reply_to_message_id`

---

## Commit → Push Flow

1. `notify` summary (silent) before committing.
2. Commit.
3. Edit the notify message to add a `↑ Push` button.
4. `wait_for_callback_query` — wait for operator tap.
5. `answer_callback_query` to dismiss spinner.
6. Send `notify` "Pushing…" (save message_id).
7. Remove the button from step 3.
8. Push.
9. Edit "Pushing…" in-place → "✅ Pushed `sha` → `main`".

---

## Multi-Step Tasks

Use `update_status` for any task with 3+ steps.

```txt
msg = update_status(title, steps: [{label, status: "running"}, ...])
pin_message(msg.message_id, disable_notification: true)
# ... update after each step ...
unpin_message(msg.message_id)
```

Status values: `pending` · `running` · `done` · `failed` · `skipped`

---

## Pinned Messages

Pin for: live task checklists, session state, important reference during complex work.  
Always `disable_notification: true`. Unpin when content is no longer relevant.

---

## Loop

Call `wait_for_message` again after every task, timeout, or error — loop forever.  
Only `exit` from the operator ends the loop.  
When unsure whether to stop, ask via Telegram and wait for the operator's answer.

On timeout (`{ timed_out: true }`): call `wait_for_message` again immediately. Normal idle behavior.

---

## Session End

1. Send `notify` (severity: "success") summarizing what was done and what's pending.
2. Confirm all items are saved/committed as needed.

# Telegram Communication Guide

All agent communication goes through Telegram. The operator is on their phone — not watching the agent panel.

MCP resources: `telegram-bridge-mcp://communication-guide` (full) · `telegram-bridge-mcp://quick-reference` (hard rules only)

---

## Hard Rules

1. **`send_confirmation`** — all yes/no questions. Always buttons.
2. **`choose`** — all multi-option questions. Always buttons.
3. **`dequeue_update`** — all update waiting. Blocks up to timeout with `pending` count.
4. **`reply_to_message_id`** — include on every reply to thread messages visually.
5. **Commit/push** — get explicit operator approval first. Send a `notify` summary before committing.
6. **`show_typing`** — call when you are actively composing a reply. This is the "I'm about to respond" signal — not a generic receipt acknowledgement. It tells the operator a response is imminent.
7. **React 👀 immediately on voice messages.** Set 👀 the moment a voice message arrives (before transcription). For short text messages ("yes", "ok"), skip the reaction — `show_typing` is the acknowledgement. For longer text tasks, use a *temporary* 👀 (timeout ≤5s, restore_emoji: null) that auto-clears on your first outbound. Update 👀 to 🫡 or 👍 once work is complete; never leave it unresolved.
8. **Drain before you speak** — before sending any message, drain pending updates with `dequeue_update(timeout=0)` until empty. Never talk over the operator; always hear them out first. Responding without draining makes it look like you dismissed what they said. When `pending > 0`, show a typing indicator while continuing to drain — the operator can see you're reading through their messages.

---

## Tool Selection

| Situation | Tool |
| --- | --- |
| Pure statement / preference | React (🫡 👍 👀 ❤) — no text reply |
| Yes/No decision | `send_confirmation` |
| Fixed options | `choose` |
| Open-ended input | `ask` |
| Short status (1–2 sentences) | `notify` |
| Ephemeral placeholder ("Thinking…") | `show_animation` / `cancel_animation` |
| Structured result / explanation | `send_text` (Markdown) |
| Build / deploy / error event | `notify` with severity |
| Multi-step task (3+ steps) | `send_new_checklist` checklist |

---

## Reactions

```txt
👀 = I'm processing this right now (set IMMEDIATELY on receive — the "eyes are on it" signal)
🫡 = got it / acknowledged / understood (receipt of a simple statement or instruction)
👍 = task complete / confirmed done
❤  = great / love it
```

**Lifecycle pattern:** React 👀 the moment you receive a message — this is the first thing you do, before any processing. Once you've responded or completed work, update the reaction to 🫡 (acknowledgement) or 👍 (task done). This gives the operator a live status indicator: 👀 = still in progress, resolved emoji = done.

**👀 on text vs voice messages:**
- **Voice messages** — set 👀 immediately; it stays while transcribing; update to 🫡 when done. The processing genuinely takes time so the 👀 is meaningful.
- **Short text messages** ("yes", "proceed", "ok") — skip 👀 entirely. `show_typing` is the acknowledgement; you're already responding. A permanent 👀 on a "yes" looks like you're permanently staring at the message.
- **Longer text tasks** — set 👀 as a *temporary* reaction (`restore_emoji: null`, `timeout_seconds ≤ 5`) so it auto-clears on your next outbound or within 5 seconds, whichever comes first.

`show_typing` = I'm composing a reply right now — use this when a text response is imminent, not as a generic "received" signal. The order should be: receive → (👀 only if voice or long task) → do work → `show_typing` → send reply → update reaction to 🫡/👍.

---

## Message Formatting

- `*bold*` for headers and key terms
- `` `code` `` for commands, paths, values
- ` ``` ` for command output / config snippets
- Always thread replies with `reply_to_message_id`

### Symbol usage — quiet vs loud

Prefer the **quiet Unicode symbol** over the emoji version unless you need to signal strong finality:

| Situation | Use | Avoid |
| --- | --- | --- |
| Task done (quiet) | ✓ (U+2713) | ✅ (emoji) |
| Cancel / reject (quiet) | ✗ (U+2717) | ❌ (emoji) |
| Strong positive completion | ✅ (emoji) | — |
| Strong negative / warning | ❌ (emoji) | — |

The ✅/❌ emoji carry high visual weight — they're right for one-off confirmations and final results, but feel loud when used repeatedly.  
The ✓/✗ characters read as a natural part of text and work well inside button labels, checklist items, inline status notes, and anywhere the context already provides enough emphasis.

---

## Commit → Push Flow

1. `notify` summary (silent) before committing.
2. Review every `.md` file touched during the session — fix any markdown warnings, broken links, inconsistent heading levels, trailing spaces, or formatting issues, however trivial.
3. Commit.
4. Edit the notify message to add a `↑ Push` button.
5. `dequeue_update` — wait for operator tap (callback query).
6. `answer_callback_query` to dismiss spinner.
7. Send `notify` "Pushing…" (save message_id).
8. Remove the button from step 4.
9. Push.
10. Edit "Pushing…" in-place → "✅ Pushed `sha` → `main`".

---

## Multi-Step Tasks

Use `send_new_checklist` for any task with 3+ steps.

```txt
msg = send_new_checklist(title, steps: [{label, status: "running"}, ...])
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

Call `dequeue_update` again after every task, timeout, or error — loop forever.  
Only `exit` from the operator ends the loop.  
When unsure whether to stop, ask via Telegram and wait for the operator's answer.

On timeout (`{ timed_out: true }`): call `dequeue_update` again immediately. Normal idle behavior.

---

## Session End

1. Send `notify` (severity: "success") summarizing what was done and what's pending.
2. Confirm all items are saved/committed as needed.

---
applyTo: "**"
---
# Telegram Communication — Hard Rules

Full guide: `COMMUNICATION.md` · MCP resource: `telegram-bridge-mcp://communication-guide`

---

## Always

1. **Reply via Telegram** for every substantive action or decision.
2. **`send_confirmation`** for all yes/no questions — always buttons.
3. **`choose`** for all multi-option questions — always buttons.
4. **`wait_for_message`** for all input waiting — long-polls correctly.
5. **`reply_to_message_id`** on every reply — threads messages visually.
6. **`show_typing`** immediately after receiving a message, before starting work.
7. **React 🫡** when starting multi-step work. Update to 👍 or ❤ when done.
8. **`notify` (silent) before committing.** Get explicit approval before pushing.
9. **`wait_for_message` again** after every task, timeout, or error — loop forever.
10. **Ask via Telegram** when unsure whether to stop. Wait for the answer.

## Tool Selection

| Situation | Tool |
|---|---|
| Statement / preference | React (🫡 👍 👀 ❤) |
| Yes/No decision | `send_confirmation` |
| Fixed options | `choose` |
| Open-ended input | `ask` |
| Status / result | `notify` or `send_message` |
| Multi-step task (3+) | `update_status` + `pin_message` |

See `COMMUNICATION.md` for formatting, commit/push flow, pinning, and session end patterns.


---

## Message Types and When to Use Each

### 1. Emoji Reaction (`mcp_telegram_set_reaction`)

Use for: immediate acknowledgment that work has started or is complete.

```
🫡  = "I'm on it" — react immediately when beginning multi-step work
👀  = noted / I see this — passive acknowledgment
👍  = confirmed / understood
❤   = great / I like this
```

**Work-in-progress pattern:**
- On receipt of a message that triggers multi-step work: react with 🫡 immediately
- When work is done: remove 🫡 and add a different reaction (👍, ❤), or just leave it changed
- This gives the operator real-time visibility without requiring text replies

**Use for acknowledgment only when:** Operator sends a statement of preference, policy, or informational update with no question. Don't send a text reply — just react.

**Do NOT use when:** The message contains a question, a decision point, or implies a substantive answer is expected. In those cases, reply with text and optionally also react.

---

### 2. Short Voice Confirmation (`mcp_telegram_send_message` with `voice: true`)

Use for: 1-2 sentence confirmations where audio is appropriate.

**When to use:**
- Quick status ping: "Done, container restarted."
- One-sentence acknowledgment where audio feels natural.

**When NOT to use:**
- The reply is longer than 2 sentences
- The reply contains structured info (lists, code, paths, numbers)
- The operator sent text in an interactive Q&A exchange (ask/answer — match the medium)

---

### 3. Text Message — Markdown (`mcp_telegram_send_message` with `voice: false`)

Use for: anything substantive — status updates, results, instructions, structured info.

**Always include:** `reply_to_message_id` set to the message being responded to. This threads replies visually in the Telegram client so the operator can track what each message is for.

**Format guidance:**
- Use `*bold*` for section headers and key terms
- Use `` `code` `` for commands, paths, and values
- Use code blocks (`` ``` ``) for script output, config snippets, commands
- Use bullet lists for multiple items

**When to use:**
- Reporting completion of a multi-step operation
- Explaining what changed and why
- Answering a question that requires more than a sentence
- Any output containing structured data

---

### 4. Notification (`mcp_telegram_notify`)

Use for: event-driven updates with severity levels (info / success / warning / error).

```
severity: "info"     — neutral update
severity: "success"  — task completed successfully
severity: "warning"  — something worth noting, non-critical
severity: "error"    — something failed
```

Good for: build results, deploy outcomes, error summaries.

---

### 5. Yes/No Confirmation (`mcp_telegram_send_confirmation`) — BUTTONS REQUIRED

**HARD RULE: ALWAYS use buttons for binary questions. NEVER ask a yes/no question as plain text. This is non-negotiable.**

```
mcp_telegram_send_confirmation(
  text: "Do you want me to restart the provisioner now?",
  reply_to_message_id: <message_being_replied_to>
)
```

`send_confirmation` blocks until the user presses a button, automatically collapses the keyboard, and returns `{ confirmed: true|false }`. No follow-up `edit_message_text` needed.

---

### 5a. Single-Action Button (push confirmation pattern)

**Use after committing** — show a single "↑ Push" button. The operator taps to approve; if they want something different, they reply with text instead. This avoids the friction of a full Yes/No dialog for a common, low-risk confirmation.

**Pattern — single push button:**
```
# 1. Send the commit summary
msg = mcp_telegram_notify(title: "Feature X — committed", body: "...")

# 2. Add a single ↑ Push button to the message
mcp_telegram_edit_message_text(
  message_id: msg.message_id,
  text: "...",  # same text as notify
  reply_markup: { inline_keyboard: [[{ text: "↑ Push", callback_data: "push" }]] }
)

# 3. Wait for the tap (or a text reply if they want something else)
result = mcp_telegram_wait_for_callback_query(message_id: msg.message_id, timeout_seconds: 300)

# 4. Acknowledge the button tap
mcp_telegram_answer_callback_query(callback_query_id: result.callback_query_id)

# 5. Notify operator that the push is starting (BEFORE pushing) — save message_id
push_msg = mcp_telegram_notify(
  title: "Pushing…",
  body: "Pushing <commit_sha> → main on <repo>",
  severity: "info",
  reply_to_message_id: msg.message_id
)

# 6. Remove the ↑ Push button from the commit message
mcp_telegram_edit_message_text(
  message_id: msg.message_id,
  text: "...",  # same text, no button
  reply_markup: { inline_keyboard: [] }
)

# 7. Push
git push origin main

# 8. EDIT the "Pushing…" message in-place — become the final "Pushed" confirmation
#    Do NOT send a separate message. Replace the in-flight status with the result.
mcp_telegram_edit_message_text(
  message_id: push_msg.message_id,
  text: "✅ **Pushed**\n`<old_sha>..<new_sha>` → `main` on `<repo>`"
)
```

**When operator replies with text instead:** handle the reply as their instruction (e.g., "push to feature branch instead" or "don't push yet").

**Use for:** push confirmation after every commit. Keeps the workflow fast — one tap to proceed.

---

### 6. Multi-Option Choice (`mcp_telegram_choose`)

**Always use buttons for discrete choices.** Do NOT list options as plain text.

```
mcp_telegram_choose(
  question: "Which agent should I update?",
  options: [
    { label: "Provisioner", value: "provisioner" },
    { label: "Claw", value: "claw" },
    { label: "Zev", value: "zev" }
  ],
  reply_to_message_id: <message_being_replied_to>
)
```

`choose` handles the callback acknowledgment and keyboard collapse automatically. Returns `{ label, value }`.

---

### 7. Waiting for Input (`mcp_telegram_wait_for_message`)

Use `wait_for_message` to block and wait for the operator's reply. **Do NOT poll with `get_updates` in a loop** — `wait_for_message` long-polls correctly and is more efficient.

```
result = mcp_telegram_wait_for_message(timeout_seconds: 300)
if result.timed_out:
    # handle timeout — operator may be AFK
```

---

### 8. Live Task Checklist (`mcp_telegram_update_status`)

Sends (or edits in-place) a checklist message showing step-by-step progress for multi-step work. The operator sees a single message that updates live — no notification spam.

**Pattern:**
```
# First call — sends the message, returns message_id
msg = mcp_telegram_update_status(
  title: "Feature: rate limiting",
  steps: [
    { label: "Config field", status: "running" },
    { label: "Middleware", status: "pending" },
    { label: "Wire into main", status: "pending" },
    { label: "cargo check", status: "pending" },
  ]
)

# Subsequent calls — edit in-place with the same message_id
mcp_telegram_update_status(
  message_id: msg.message_id,
  title: "Feature: rate limiting",
  steps: [
    { label: "Config field",   status: "done" },
    { label: "Middleware",     status: "running" },
    { label: "Wire into main", status: "pending" },
    { label: "cargo check",    status: "pending" },
  ]
)
```

**Status values:** `pending` · `running` · `done` · `failed` · `skipped`

**When to use:** Any task with 3+ sequential steps. Start it before the first step; update after each one completes.

**Pin the checklist** at the start of long-running tasks so the operator sees live progress without scrolling:
```
mcp_telegram_pin_message(message_id: msg.message_id, disable_notification: true)
```
Unpin when done:
```
mcp_telegram_unpin_message(message_id: msg.message_id)
```

---

### 9. Pinned Messages — Persistent Context (`mcp_telegram_pin_message` / `mcp_telegram_unpin_message`)

Pinned messages appear prominently at the top of the chat. Use them to maintain shared context that the operator should be able to glance at anytime.

**Good use cases:**
- **Live task checklist** — pin `update_status` message for the duration of a multi-step task; unpin when complete
- **Session state summary** — pin a message listing what's in-progress, what's blocked, and what's done for a long session
- **Reference documents** — pin a config snapshot, architecture summary, or key decision before starting complex work; unpin when superseded
- **Active deploy / migration status** — pin progress during a production change so the operator can check without asking

**Rules:**
- Always `disable_notification: true` when pinning — do not spam the operator
- Unpin proactively when the content is no longer relevant (task complete, reference superseded)
- Only one pin should be "active context" at a time — unpin before pinning something new unless both are separately useful

---

## Decision Tree: Which Tool to Use?

```
Operator message received
│
├─ Pure statement / preference / info → React (👍 / 👀 / 🫡)
│
├─ Contains a question or decision point
│  ├─ Yes/No → send_confirmation (buttons)
│  ├─ Multiple discrete options → choose (buttons)
│  └─ Open-ended → send_message or ask (text)
│
└─ Reporting a result / status
   ├─ Very short (1-2 sentences) → voice message
   ├─ Contains structure or is > 2 sentences → text message (markdown)
   └─ Event-driven (build, deploy, error) → notify

Starting multi-step work (3+ steps)?
├─ Create update_status checklist before first step
├─ Pin it (disable_notification: true)
├─ Update after every step
└─ Unpin when done
```

---

## Anti-Patterns to Avoid

| Anti-pattern | Correct approach |
|---|---|
| Asking "Do you want X? (yes/no)" as plain text | Use `send_confirmation` (Yes/No buttons) |
| Listing "Option A, B, C" as plain text | Use `choose` (inline buttons) |
| Sending a long voice summary | Send markdown text instead |
| Acknowledging with "Got it" or "Understood" text | React with 👍 or 👀 |
| Replying without `reply_to_message_id` | Always thread replies |
| Polling `get_updates` in a loop | Use `wait_for_message` |
| Sending multiple separate messages for one event | Batch into one message |
| Running `git commit` or `git push` without warning | Send `notify` summary first, then commit |

---

## Session Start / End

**Start:** No explicit greeting needed. Begin work and send a brief status once there's something to report. **Every incoming operator message must be added to the active todo list immediately** — do not let messages go untracked.

**Loop timeout:** When `wait_for_message` returns `timed_out: true`, send a silent notification, sleep 10 minutes, then re-engage the loop automatically:
```
mcp_telegram_notify(title: "Loop timed out", body: "No message received — sleeping 10 min then re-engaging.", severity: "warning", disable_notification: true)
# sleep 10 minutes
wait_for_message(timeout_seconds: 300)  # re-engage
```
Only exit the loop entirely when the VS Code session ends or the operator explicitly says to stop. Do not silently drop out of the loop without telling the operator.

**End:** Before closing a session:
1. Send a final summary message: what was accomplished, what's pending
2. Ensure session log is updated and committed
3. Use `notify` with `severity: "success"` if everything completed cleanly

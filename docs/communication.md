# Telegram Communication Guide

When the operator has initiated loop mode, all substantive agent communication goes through Telegram. The operator is on their phone — not watching the agent panel.

MCP resource: `telegram-bridge-mcp://communication-guide`

---

## Session Flow

Every session follows this loop:

1. **Announce** — call `action(type: "session/start")` to announce your presence and handle any pending messages from the previous session.
2. **Call `dequeue`** — blocks up to 300 s waiting for the next update.
3. **On receive** — work through the message handling pipeline:
   a. **Voice message?** The server already manages reactions: ✍ while transcribing, then 🫡 once your `dequeue` call returns it to you. No reaction action needed from you.
   b. **Show a thinking animation** — the human can see you're considering a plan.
   c. **Once the action plan is clear**, switch to a working animation — signals you're now executing.
   d. **When ready to reply**, call `action(type: "show-typing")` — signals your response is imminent.
   e. **Send the reply.** Prefer `confirm` / `choose` for any decision; use `send(audio: "...")` if the operator prefers audio responses.
4. **Loop** — go back to step 2.

The thinking → working → `action(type: "show-typing")` pipeline gives the operator a live status signal at every stage. You don't have to use all three for short tasks — jumping straight to working or `action(type: "show-typing")` is fine. The key is to never go silent.

---

## Hard Rules

1. **`confirm`** — all yes/no questions. Always buttons.
   Quick presets: `action(type: "confirm/ok")` · `action(type: "confirm/ok-cancel")` · `action(type: "confirm/yn")` — use before writing custom `send(type: "question", choose: [...])`.
2. **`choose`** — all multi-option questions. Always buttons.
3. **`dequeue`** — sole tool for receiving updates. Returns `{ updates: [...] }`: non-content events first, optionally ending with a content message.
4. **Commit/push** — get explicit operator approval first. Send a `send(type: "notification")` summary before committing.
5. **`action(type: "show-typing")`** — call when composing a reply. This is the "response is imminent" signal, not a generic receipt.
6. **👀 is optional — always temporary.** The server automatically manages voice reactions: ✍ while transcribing, 😴 if queued with no active waiter, and 🫡 when your `dequeue` returns it to you — no agent action needed. If you choose to set 👀 (to signal active attention on any message), it must always be `temporary: true`. Use it sparingly — reserve it for messages you are genuinely focused on, not as blanket acknowledgement. Skip it entirely when draining a backlog.
7. **Watch `pending`.** A non-zero `pending` in the `dequeue` result means the operator has sent more messages while you were working. They may have changed their mind or added details. Consider calling `dequeue` once more before acting, to fold new context into your plan or queue it as the next task.

---

## Tool Selection

| Situation | Tool |
| --- | --- |
| Pure statement / preference | React (🫡 👍 👀 🤔 ❤) — no text reply |
| Yes/No decision | `confirm` |
| Fixed options | `choose` (blocking, waits for tap) · `send_choice` (non-blocking) |
| Open-ended input | `ask` (shortcut: send question + wait for reply) |
| Short status (1–2 sentences) | `send(type: "notification")` |
| Thinking / considering | `send(type: "animation")` (thinking preset) |
| Executing / working | `send(type: "animation")` (working preset) |
| Response is imminent | `action(type: "show-typing")` |
| Cancel an animation | `action(type: "animation/cancel")` |
| Structured result / explanation | `send(type: "text")` (Markdown) |
| Simple plain-english reply (if preferred) | `send(audio: "...")` |
| Build / deploy / error event | `send(type: "notification")` with severity |
| Multi-step task (3+ steps) | `send(type: "checklist")` |
| Completed work / ready to proceed | `confirm` (single-button CTA, no `no_text`) |
| Forward user message to another session | `action(type: "message/route")` |
| Send private note to another session | `send(type: "dm")` |

---

## Reactions

```txt
👀 = "I'm actively considering this" — optional agent signal; always temporary
🤔 = actively thinking / processing — pair with a thinking animation
🫡 = got it / acknowledged / understood
👍 = task complete / confirmed done
❤  = great / love it
```

**What 👀 means to humans:** it signals that your eyes are on a specific message — you've caught up to it and are actively processing it. It's too static to mean "thinking"; it means "received and in progress." Because of this weight, use it sparingly:

- **Voice messages** — the server manages reactions automatically (✍ → 😴/🫡). No agent action required.
- **Text messages** — 👀 is allowed when you are genuinely focused on the message (e.g., a long multi-part request). Use it sparingly — not as a blanket acknowledgement for every message.
- **Draining a backlog** — skip reactions entirely when processing a queue of accumulated messages. Reactions on every item create noise.
- **👀 is always temporary** — when you set 👀, always use `temporary: true` (`timeout_seconds ≤ 5`, omit `restore_emoji`) so it auto-clears. Other reactions (🫡, 👍, 🤔) may be permanent or temporary depending on context.
- **🤔 for active thinking** — use 🤔 when you are actively processing or considering a message. Pair it with a thinking animation for a clear signal to the operator.

`action(type: "show-typing")` = response is imminent — not a generic "received" signal. Call it just before you send. The full pipeline: receive → think (🤔 + animation) → work → `action(type: "show-typing")` → send → optionally update reaction to 🫡/👍.

---

## Button Design

Humans strongly prefer tapping a button over typing a reply. When a decision is needed, always use buttons.

**Color (`primary`, `success`, `danger`, no style)**

- `primary` (blue) is the recommended emphasis color for the expected or positive action — use it to guide the operator's eye.
- The default unstyled button is not always positive — you decide which action deserves `primary` based on context.
- For a genuinely unbiased A/B choice where neither option is preferred, use no color on either button.
- Avoid applying `primary` to both buttons — it defeats the purpose.

### Symbols and icons

- Symbols/unicode icons in button labels are strongly encouraged — they add clarity at a glance.
- **All-or-nothing rule:** if any button in a set has a symbol or emoji, all buttons in that set must have one.
- Emojis (e.g. 🟢 🔴) only belong in *unstyled* buttons — they clash visually with colored buttons. Use plain text + icon characters (e.g. `✓ Yes`, `✗ No`) when a style is applied.

### Keep confirm prompts short

The operator is usually on a phone with limited screen space. If a `confirm` or `choose` needs context, send the explanation as a **separate message first**, then send the decision prompt as a short follow-up. This keeps the buttons visible without scrolling.

**Bad:** One long message with explanation + `confirm` — buttons scroll off-screen on mobile.

**Good:** `send(type: "text")` with the context → `confirm` with a one-line question.

### Single-button CTA

Pass an empty string to `no_text` on `confirm` to render a single centered button — ideal for "done / continue" moments.

---

## `dequeue` and the Pending Queue

`dequeue` is the sole tool for receiving updates. Each call returns `{ updates: [...] }`: non-content events (reactions, callback queries) come first, optionally followed by a content message from the operator.

```text
Normal loop:
  loop:
    result = dequeue()          # blocks up to 300 s
    handle result
    goto loop

On timeout ({ timed_out: true }):
  send a brief `send(type: "notification")` ("Still here — are you there?") then call dequeue() again.
```

**The `pending` field is a warning.** When `pending > 0`, the operator has sent more messages while you were working — they may have changed their mind, added details, or cancelled the task. Before acting on your current plan, consider calling `dequeue` once more to check. You can fold the new context into your current plan or treat it as the next task after you finish.

Never assume silence means approval. If unsure whether to proceed, ask via `confirm` and wait.

---

## Message Formatting

- `*bold*` for headers and key terms
- `` `code` `` for commands, paths, values
- ` ``` ` for command output / config snippets
- Use `reply_to_message_id` at most once per response thread — thread the first reply to a specific operator message for context, then let subsequent messages flow unthreaded

### Telegram Markdown limitations

Telegram's Markdown does **not** support tables. Pipe-delimited tables render as garbled text. When you need tabular data, use one of these alternatives:

- **Monospaced block** — wrap in ` ``` ` with manually aligned columns
- **Bulleted list** — one item per row, bold the key: `*Key:* value`
- **Labeled lines** — `Key → value` on separate lines

Never send a Markdown table via `send(type: "text")` — it will look broken on the operator's phone.

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

1. `send(type: "notification")` summary (silent) before committing.
2. Review every `.md` file touched during the session — fix any markdown warnings, broken links, inconsistent heading levels, trailing spaces, or formatting issues, however trivial.
3. Commit.
4. Edit the notification message to add a `↑ Push` button.
5. `dequeue` — wait for operator tap (callback query).
6. `answer_callback_query(remove_keyboard: true, message_id: <step 4 message_id>)` — dismisses spinner and removes the Push button in one call.
7. Send `send(type: "notification")` "Pushing…" (save message_id).
8. _(Button already removed in step 6.)_
9. Push.
10. Edit "Pushing…" in-place → "✅ Pushed `sha` → `main`".

---

## Announce Before Major Actions

Before any significant state-changing operation, briefly state what you're about to do:

| Action | How to announce |
| --- | --- |
| Commit | `send(type: "notification")` summary of changes before committing |
| Push | `send(type: "text")` "Pushing now…" |
| Build / compile | `send(type: "text")` "Building now — ~10s…" |
| Restart server | `send(type: "text")` "Restarting server…" |
| Delete files | `send(type: "text")` "Deleting X…" |
| Destructive / irreversible | `confirm` — require explicit approval first |

This keeps the operator's eyes on what's happening. A brief heads-up before a restart or push means they won't be surprised when the bot goes quiet for a few seconds. It's not a formal gate — just transparency.

For any action that is hard or impossible to reverse (deleting branches, `reset --hard`, dropping data), always stop and ask first.

---

## Multi-Step Tasks

Use `send(type: "checklist")` for any task with 3+ steps.

```txt
msg = send(type: "checklist", title, steps: [{label, status: "running"}, ...])
action(type: "checklist/update", message_id: msg.message_id, steps: [{label, status: "done"}, {label, status: "running"}, ...])
```

Status values: `pending` · `running` · `done` · `failed` · `skipped`

---

## Pinned Messages

Pin for: live task checklists, session state, important reference during complex work.  
Always `disable_notification: true`. Unpin when content is no longer relevant.

---

## Loop

Call `dequeue` again after every task, timeout, or error — loop forever.  
Only `exit` from the operator ends the loop.  
When unsure whether to stop, ask via Telegram and wait for the operator's answer.

On timeout (`{ timed_out: true }`): send a brief `send(type: "notification")` ("Still here — are you there?") then call `dequeue` again.

---

## Session End

1. Send `send(type: "notification", severity: "success")` summarizing what was done and what's pending.
2. Confirm all items are saved/committed as needed.

---

## Multi-Session Loop

When 2+ sessions are active, the loop is the same but the `routing` field on dequeued events guides message ownership.

### Routing field on events

```text
routing: "targeted"   — reply to one of your messages; handle it
routing: "ambiguous"  — no clear owner; apply context to decide
(absent)              — single-session mode; no routing decisions needed
```

### Adjusted loop for governor sessions

```text
loop:
  result = dequeue()
  for each event in result.updates:
    if event.routing == "targeted":
      handle normally
    else if event.routing == "ambiguous":
      if clearly for another session: action(type: "message/route", ...)
      else: handle it (governor is fallback owner)
  goto loop
```

### Governor responsibilities

The governor session (lowest SID) owns ambiguous traffic by default. If you are governor:

- Triage ambiguous messages and route to the right agent when appropriate.
- Coordinate multi-session workflows.
- You may become governor unexpectedly if the previous governor closes.

Non-governor sessions: handle your targeted messages, forward genuinely mis-addressed ones.

---

## Memory Safety

Session memory is advisory, not authoritative. Before acting on stored state:

- Re-check live session, queue, and board state with tools
- Never trust stored SID/PIN or active-task state without verification
- If memory conflicts with live tool state or current operator instruction, memory loses

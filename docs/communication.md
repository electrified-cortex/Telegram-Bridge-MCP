# Telegram Communication Guide

All agent communication goes through Telegram. The operator is on their phone — not watching the agent panel.

MCP resource: `telegram-bridge-mcp://communication-guide`

---

## Session Flow

Every session follows this loop:

1. **Announce** — send a brief `notify` that you're online and ready.
2. **Call `dequeue_update`** — blocks up to 60 s waiting for the next update.
3. **On receive** — work through the message handling pipeline:
   a. **Voice message?** Set a *temporary* 👀 reaction immediately — signals to the human that you caught the message and are processing it.
   b. **Show a thinking animation** — the human can see you're considering a plan.
   c. **Once the action plan is clear**, switch to a working animation — signals you're now executing.
   d. **When ready to reply**, call `show_typing` — signals your response is imminent.
   e. **Send the reply.** Prefer `confirm` / `choose` for any decision; use `send_text_as_voice` if the operator prefers audio responses.
4. **Loop** — go back to step 2.

The thinking → working → `show_typing` pipeline gives the operator a live status signal at every stage. You don't have to use all three for short tasks — jumping straight to working or `show_typing` is fine. The key is to never go silent.

---

## Hard Rules

1. **`confirm`** — all yes/no questions. Always buttons.
2. **`choose`** — all multi-option questions. Always buttons.
3. **`dequeue_update`** — sole tool for receiving updates. Returns `{ updates: [...] }`: non-content events first, optionally ending with a content message.
4. **Commit/push** — get explicit operator approval first. Send a `notify` summary before committing.
5. **`show_typing`** — call when composing a reply. This is the "response is imminent" signal, not a generic receipt.
6. **👀 on voice messages only — always temporary.** Set 👀 the moment a voice message arrives (before transcription). Pass `timeout_seconds ≤ 5` and omit `restore_emoji` so it auto-removes. Update to 🫡 or 👍 when done. For text messages, skip 👀 entirely — `show_typing` is the acknowledgement.
7. **Watch `pending`.** A non-zero `pending` in the `dequeue_update` result means the operator has sent more messages while you were working. They may have changed their mind or added details. Consider calling `dequeue_update` once more before acting, to fold new context into your plan or queue it as the next task.

---

## Tool Selection

| Situation | Tool |
| --- | --- |
| Pure statement / preference | React (🫡 👍 👀 ❤) — no text reply |
| Yes/No decision | `confirm` |
| Fixed options | `choose` (blocking, waits for tap) · `send_choice` (non-blocking) |
| Open-ended input | `ask` (shortcut: send question + wait for reply) |
| Short status (1–2 sentences) | `notify` |
| Thinking / considering | `show_animation` (thinking preset) |
| Executing / working | `show_animation` (working preset) |
| Response is imminent | `show_typing` |
| Cancel an animation | `cancel_animation` |
| Structured result / explanation | `send_text` (Markdown) |
| Simple plain-english reply (if preferred) | `send_text_as_voice` |
| Build / deploy / error event | `notify` with severity |
| Multi-step task (3+ steps) | `send_new_checklist` + `pin_message` |
| Completed work / ready to proceed | `confirm` (single-button CTA, no `no_text`) |

---

## Reactions

```txt
👀 = "I caught this message and am processing it" — set on voice messages only; always temporary
🫡 = got it / acknowledged / understood
👍 = task complete / confirmed done
❤  = great / love it
```

**What 👀 means to humans:** it signals that your eyes are on a specific message — you've caught up to it and are actively processing it. It's too static to mean "thinking"; it means "received and in progress." Because of this weight, use it sparingly:

- **Voice messages** — set 👀 immediately as a *temporary* reaction (omit `restore_emoji`, set `timeout_seconds ≤ 5`). It auto-clears so it doesn't linger after you've responded.
- **Text messages** — skip 👀 entirely. `show_typing` is the acknowledgement for text.
- **You may use 👀 on other messages** if the situation genuinely warrants it (e.g., a long multi-part request). But always make it temporary and always resolve it to 🫡 or 👍.

`show_typing` = response is imminent — not a generic "received" signal. Call it just before you send. The full pipeline: receive → (👀 if voice) → think → work → `show_typing` → send → update reaction to 🫡/👍.

---

## Button Design

Humans strongly prefer tapping a button over typing a reply. When a decision is needed, always use buttons.

**Color (`primary`, `success`, `danger`, no style)**

- `primary` (blue) is the recommended emphasis color for the expected or positive action — use it to guide the operator's eye.
- The default unstyled button is not always positive — you decide which action deserves `primary` based on context.
- For a genuinely unbiased A/B choice where neither option is preferred, use no color on either button.
- Avoid applying `primary` to both buttons — it defeats the purpose.

**Symbols and icons**

- Symbols/unicode icons in button labels are strongly encouraged — they add clarity at a glance.
- **All-or-nothing rule:** if any button in a set has a symbol or emoji, all buttons in that set must have one.
- Emojis (e.g. 🟢 🔴) only belong in *unstyled* buttons — they clash visually with colored buttons. Use plain text + icon characters (e.g. `✓ Yes`, `✗ No`) when a style is applied.

**Single-button CTA**

Pass an empty string to `no_text` on `confirm` to render a single centered button — ideal for "done / continue" moments.

---

## `dequeue_update` and the Pending Queue

`dequeue_update` is the sole tool for receiving updates. Each call returns `{ updates: [...] }`: non-content events (reactions, callback queries) come first, optionally followed by a content message from the operator.

```text
Normal loop:
  loop:
    result = dequeue_update()          # blocks up to 60 s
    handle result
    goto loop

On timeout ({ empty: true }):
  call dequeue_update() again immediately — this is normal idle behavior.
```

**The `pending` field is a warning.** When `pending > 0`, the operator has sent more messages while you were working — they may have changed their mind, added details, or cancelled the task. Before acting on your current plan, consider calling `dequeue_update` once more to check. You can fold the new context into your current plan or treat it as the next task after you finish.

Never assume silence means approval. If unsure whether to proceed, ask via `confirm` and wait.

---

## Message Formatting

- `*bold*` for headers and key terms
- `` `code` `` for commands, paths, values
- ` ``` ` for command output / config snippets
- Use `reply_to_message_id` at most once per response thread — thread the first reply to a specific operator message for context, then let subsequent messages flow unthreaded

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

## Announce Before Major Actions

Before any significant state-changing operation, briefly state what you're about to do:

| Action | How to announce |
| --- | --- |
| Commit | `notify` summary of changes before committing |
| Push | `send_text` "Pushing now…" |
| Build / compile | `send_text` "Building now — ~10s…" |
| Restart server | `send_text` "Restarting server…" |
| Delete files | `send_text` "Deleting X…" |
| Destructive / irreversible | `confirm` — require explicit approval first |

This keeps the operator's eyes on what's happening. A brief heads-up before a restart or push means they won't be surprised when the bot goes quiet for a few seconds. It's not a formal gate — just transparency.

For any action that is hard or impossible to reverse (deleting branches, `reset --hard`, dropping data), always stop and ask first.

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

On timeout (`{ empty: true }`): call `dequeue_update` again immediately. Normal idle behavior.

---

## Session End

1. Send `notify` (severity: "success") summarizing what was done and what's pending.
2. Confirm all items are saved/committed as needed.

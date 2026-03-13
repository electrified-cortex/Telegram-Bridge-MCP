---
applyTo: "**"
---
# Telegram Communication — Hard Rules

Full guide: `communication.md` · MCP resource: `telegram-bridge-mcp://communication-guide`

---

## Always

1. **Reply via Telegram** for every substantive action or decision.
2. **`send_confirmation`** for all yes/no questions — always buttons.
3. **`choose`** for all multi-option questions — always buttons.
4. **`wait_for_message`** for all input waiting — long-polls correctly.
5. **`reply_to_message_id`** on every reply — threads messages visually.
6. **`show_typing`** when a text reply is imminent — this is the "I'm about to respond" signal, not a generic receipt acknowledgement. Points the operator's eyes at the chat.
7. **Reactions have specific meanings.** 👀 = "I'm processing this" — set immediately on **voice messages**, before any other action. For **short text messages** ("yes", "ok", "proceed"), skip 👀 entirely — `show_typing` is the acknowledgement. For **longer text tasks**, use a *temporary* 👀 (≤5s timeout, `restore_emoji: null`) that auto-clears on your first outbound. 🫡 = "got it / acknowledged". 👍 / ❤ = done / great. Never leave 👀 unresolved; always update to 🫡 or 👍 when work is complete.
8. **`notify` (silent) before committing.** Get explicit approval before pushing.
9. **`wait_for_message` again** after every task, timeout, or error — loop forever.
10. **Ask via Telegram** when unsure whether to stop. Wait for the answer.
11. **Never assume silence means approval.** Always wait for explicit confirmation before proceeding with implementation.
12. **Drain before you speak.** Before sending any message, drain pending updates with `dequeue_update(timeout=0)` until empty. Never talk over the operator — always hear them out first.

## Tool Selection

| Situation | Tool |
| --- | --- |
| Statement / preference | React (🫡 👍 👀 ❤) **+ follow-up text with intent** |
| Yes/No decision | `send_confirmation` |
| Fixed options | `choose` |
| Open-ended input | `ask` |
| Status / result | `notify` or `send_message` |
| Multi-step task (3+) | `send_new_checklist` + `pin_message` |
| Completed work / ready to proceed | `send_confirmation` (single-button CTA) |

See `communication.md` for formatting, commit/push flow, pinning, and session end patterns.


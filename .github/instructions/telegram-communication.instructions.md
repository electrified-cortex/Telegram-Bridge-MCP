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
6. **`show_typing`** immediately after receiving a message, before starting work.
7. **React then acknowledge.** After reacting (🫡 👀 etc.), always follow up with a brief text saying what you understood and what you're about to do. Never react and go silent.
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
| Multi-step task (3+) | `update_status` + `pin_message` |
| Completed work / ready to proceed | `send_confirmation` (single-button CTA) |

See `communication.md` for formatting, commit/push flow, pinning, and session end patterns.


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
7. **React 🫡** when starting multi-step work. Update to 👍 or ❤ when done.
8. **`notify` (silent) before committing.** Get explicit approval before pushing.
9. **`wait_for_message` again** after every task, timeout, or error — loop forever.
10. **Ask via Telegram** when unsure whether to stop. Wait for the answer.

## Tool Selection

| Situation | Tool |
| --- | --- |
| Statement / preference | React (🫡 👍 👀 ❤) |
| Yes/No decision | `send_confirmation` |
| Fixed options | `choose` |
| Open-ended input | `ask` |
| Status / result | `notify` or `send_message` |
| Multi-step task (3+) | `update_status` + `pin_message` |

See `communication.md` for formatting, commit/push flow, pinning, and session end patterns.


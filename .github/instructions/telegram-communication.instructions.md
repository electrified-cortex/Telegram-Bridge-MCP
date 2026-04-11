---
applyTo: "**"
---
# Telegram Communication

> **Authoritative guide:** `docs/communication.md` · **MCP resource:** `telegram-bridge-mcp://communication-guide`
>
> At session start, load the MCP resource for full patterns (session flow, button design, animations, commit/push flow, loop, session end).

When Telegram MCP tools are available and the operator has initiated loop mode, **all substantive communication goes through Telegram**.

## Session Flow

```text
announce ready → dequeue (loop) → on message:
  a) voice? → server already set 🫡 (ackVoiceMessage fires on dequeue) — no manual reaction needed
  b) show thinking animation
  c) plan clear? → switch to working animation
  d) ready to reply → action(type: "show-typing") → send
→ loop
```

## Non-Negotiable Rules

1. **Reply via Telegram** for every substantive response — not the agent panel.
2. **`confirm`** for yes/no · **`choose`** for multi-option — always buttons.
3. **👀 is optional and always temporary.** The server automatically manages voice reactions (✍ while transcribing, 😴 if queued, 🫡 when dequeued) — no agent action needed for voice. You may set 👀 voluntarily on any message (`temporary: true`, omit `restore_emoji`). Skip 👀 on text messages entirely. See `docs/behavior.md` § *👀 rules* for the full table.
4. **`action(type: "show-typing")`** just before sending a reply — signals response is imminent, not a generic receipt.
5. **Watch `pending`.** Non-zero means the operator sent more while you were working — check before acting.
6. **Announce before major actions** (`send` or `send(type: "notification")`). Require `confirm` for destructive/irreversible ones.
7. **`dequeue` again** after every task, timeout, or error — loop forever.
8. **Never assume silence means approval.**
9. **Voice by default.** Use `send(audio: ...)` for conversational replies, explanations, and status updates. Reserve `send(text: ...)` for structured content that benefits from Markdown formatting (tables, code blocks, bulleted lists, task boards). When in doubt, use voice.

## Tool Selection

| Situation | Tool |
| --- | --- |
| Pure statement / preference | React (🫡 👍 👀 ❤) — no text reply |
| Yes/No decision | `confirm` |
| Fixed options | `choose` (blocking) · `send_choice` (non-blocking) |
| Open-ended input | `ask` |
| Short status (1–2 sentences) | `send(type: "notification")` |
| Thinking / considering | `send(type: "animation")` (thinking preset) |
| Executing / working | `send(type: "animation")` (working preset) |
| Response is imminent | `action(type: "show-typing")` |
| Cancel an animation | `action(type: "animation/cancel")` |
| Conversational reply | `send(audio: ...)` — **default for most responses** |
| Structured result / explanation | `send(type: "text")` (Markdown) — tables, code, lists |
| Build / deploy / error event | `send(type: "notification")` with severity |
| Multi-step task (3+) | `send(type: "checklist")` |
| Completed work / ready to proceed | `confirm` (single-button CTA) |

## Button Design

- `primary` color for the expected/positive action — guides the operator's eye.
- Unbiased A/B choices: no color on either button.
- Symbols/unicode icons strongly encouraged. **All-or-nothing** — if one button has a symbol, all must.
- Emojis only in unstyled buttons; use plain text + unicode when a style is applied.

## Async Wait Etiquette

When waiting for external events (CI, code review, deploy, etc.), **keep the channel alive**:

1. **Use a persistent animation** — `send(type: "animation")` with `persistent: true` to signal you are watching.
2. **Stay in the loop** — call `dequeue` (default 300 s) repeatedly; on timeout, check in and loop again.
3. **Check in proactively** — after each poll cycle, send a brief status update if nothing has changed (e.g., "still waiting on CI...").
4. **Handle interrupts** — if the operator sends a message during the wait, process it immediately; do not defer until the external event arrives.
5. **Cancel the animation** before sending any substantive reply — `action(type: "animation/cancel")` turns it into a permanent status message.
6. **Never go silent** — an animation without a check-in loop looks like a hung process. Proactive updates build trust.

## Visible Presence

Use `send(type: "animation")` as the default "I am thinking / working" signal.
Use `send(type: "progress")` only when you intend to update the same progress message over time.
Use `send(type: "checklist")` only for real multi-step tracked workflows.
Do not create progress or checklist artifacts for one-shot status signaling.

## Common Failure Modes

Avoid these patterns:

- Replying in VS Code chat while loop mode is active
- Restarting or recovering the session when a simple `dequeue` call would suffice
- Trusting stale memory (stored SID/PIN, old test counts) over live tool state
- Using progress/checklist tools for presence instead of `send(type: "animation")`
- Deleting or mass-editing user-visible messages without explicit approval


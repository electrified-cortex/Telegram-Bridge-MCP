---
name: telegram-mcp-communication
description: >-
  Communication conventions for Telegram bridge MCP agents. Use when
  implementing or reviewing how an agent communicates with the operator
  through the Telegram chat — tool selection, reply routing, button design,
  async wait etiquette, and voice vs text decisions.
compatibility: "Requires Telegram MCP bridge v6+"
---

# Telegram MCP Communication

When Telegram MCP tools are available and the operator has initiated loop mode,
**all substantive communication goes through Telegram**.

> **Authoritative v6 tool reference:** `docs/migration-v5-to-v6.md` in the
> Telegram MCP repo. The `help()` tool returns live documentation.

## Session Flow

```text
announce ready → dequeue (loop) → on message:
  a) voice? → server auto-reacts (✍ transcribing, 😴 queued, 🫡 dequeued)
  b) show thinking animation
  c) plan clear? → switch to working animation
  d) ready to reply → action(type: "show-typing") → send
→ loop
```

## Non-Negotiable Rules

1. **Reply via Telegram** for every substantive response — not the agent panel.
2. **Blocking questions use `send`:**
   - Yes/No: `send(type: "question", confirm: "...")`
   - Multi-option: `send(type: "question", text: "...", choose: [...])`
   - Open-ended: `send(type: "question", ask: "...")`
3. **👀 is optional and always temporary.** The server manages voice reactions
   automatically. You may set 👀 voluntarily via
   `action(type: "message/react", emoji: "👀")`.
4. **Typing indicator** just before sending: `action(type: "show-typing")`.
5. **Watch `pending`.** Non-zero on `dequeue` means the operator sent more while
   you were working — check before acting.
6. **Announce before major actions.** Use blocking `confirm` for destructive or
   irreversible operations.
7. **`dequeue` again** after every task, timeout, or error — loop forever.
8. **Never assume silence means approval.**
9. **Voice by default.** Use `send(type: "text", audio: "...")` for conversational
   replies. Reserve `send(type: "text", text: "...")` for structured content that
   benefits from Markdown (tables, code, lists). When in doubt, use voice.

## Tool Selection (v6)

| Situation | v6 Tool Call |
| --- | --- |
| Pure acknowledgment | `action(type: "message/react", emoji: "🫡")` |
| Yes/No decision | `send(type: "question", confirm: "...")` |
| Fixed options | `send(type: "question", choose: [...])` (blocking) |
| Non-blocking buttons | `send(type: "choice", text: "...", options: [...])` |
| Open-ended input | `send(type: "question", ask: "...")` |
| Short status | `send(type: "notification", text: "...", severity: "info")` |
| Thinking | `send(type: "animation", preset: "thinking")` |
| Working | `send(type: "animation", preset: "working")` |
| Response imminent | `action(type: "show-typing")` |
| Cancel animation | `action(type: "animation/cancel")` |
| Conversational reply | `send(type: "text", audio: "...")` |
| Structured result | `send(type: "text", text: "...")` (Markdown) |
| Build/deploy/error | `send(type: "notification", severity: "error")` |
| Multi-step task (3+) | `send(type: "checklist", title: "...", steps: [...])` |
| Progress tracking | `send(type: "progress", title: "...", percent: 0)` |

## Button Design

### When to Use Buttons

| Scenario | Tool |
| --- | --- |
| Destructive or irreversible operation | `confirm` (blocking) |
| 2–5 mutually exclusive options, definitive answer needed | `choose` (blocking) |
| Shortcuts/quick actions operator may ignore | `choice` (non-blocking) |
| Freeform answer | `ask` — no buttons |
| Informational only | no buttons — never |
| >6 options | `ask` — buttons don't scale |

Use buttons when the answer set is **bounded and known at send time** and speed matters (tap beats type). Do not use buttons to convey information.

### `confirm` vs `choose`

**`confirm`** — two options, framed as confirmation of a statement. Uses `yes_text`/`no_text` to relabel built-in buttons. Resolves `tapped` or `timed_out`.

```
send(type: "question", confirm: "Delete all logs?", yes_text: "🗑 Delete", no_text: "↩ Cancel")
```

**`choose`** — 2–6 labeled options, framed as a question. Takes a `choose: [...]` array with `label` and `value` per item.

```
send(type: "question", text: "Which env?", choose: [
  { label: "🟢 prod", value: "prod" },
  { label: "🟡 staging", value: "staging" },
  { label: "🔵 dev", value: "dev" }
])
```

Both are **blocking** — do not call other tools while awaiting resolution. Default poll deadline is 5 minutes (spec D1). Minimum is 60 s (spec R16); the bridge rejects anything lower unless the explicit sub-60 opt-in parameter is passed.

### Column Layout

The `columns` parameter (default: 2, max: 4) controls grid width. Match it to label length — never let labels truncate or wrap.

| Columns | Use when |
| --- | --- |
| 1 | Long labels — full sentences, file paths, anything over ~20 chars |
| 2 | Standard pairs — Yes/No, A/B options (default) |
| 3 | Short labels — single words, icon + 1–2 words |
| 4 | Icon-only or very short labels |

Rule: match columns to label length. Long labels → fewer columns. Test in chat — Telegram's button width is not programmable.

### Timeout Recovery

On `timed_out` resolution: the resolution is implementation-defined — always handle it explicitly. Do not assume timeout equals rejection or any specific value. Surface the timeout to the operator.

1. Acknowledge to operator: `"Button timed out — reply in text or I can re-ask."`
2. Re-ask if the decision is still needed.
3. **Never silently proceed with a default.** Surface the timeout — always.

Use `timeout_seconds` to set a tighter deadline for time-sensitive decisions. The bridge clears the keyboard automatically on expiry (spec R17).

### Style Rules

| Style | Color | When |
| --- | --- | --- |
| `primary` | Blue | Expected or positive action |
| `success` | Green | Confirming a safe/good outcome |
| `danger` | Red | Destructive or irreversible action |
| _(none)_ | Neutral | Unbiased A/B — no color on either button |

- Symbols/unicode icons strongly encouraged. **All-or-nothing** — if one button has a symbol, all must.
- Emojis only in **unstyled** buttons; use plain text + unicode when a style is applied.

## Async Wait Etiquette

When waiting for external events (CI, code review, deploy, etc.):

1. **Persistent animation** — `send(type: "animation", persistent: true)`.
2. **Stay in the loop** — `dequeue` (default timeout) repeatedly.
3. **Check in proactively** — brief status update after each poll cycle.
4. **Handle interrupts** — if the operator sends a message during the wait,
   process it immediately.
5. **Cancel the animation** before sending a substantive reply:
   `action(type: "animation/cancel")`.
6. **Never go silent** — an animation without check-ins looks hung.

## Visible Presence

Use `send(type: "animation")` as the default "I am thinking / working" signal.
Use `send(type: "progress")` only when you intend to update over time.
Use `send(type: "checklist")` only for real multi-step tracked workflows.
Do not create progress or checklist artifacts for one-shot status signaling.

## Common Failure Modes

Avoid these patterns:

- Replying in VS Code chat while loop mode is active
- Restarting the session when a simple `dequeue` call would suffice
- Trusting stale memory over live tool state
- Using progress/checklist tools for presence instead of animations
- Deleting or mass-editing user-visible messages without explicit approval

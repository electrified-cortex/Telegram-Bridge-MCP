Dequeue Loop — Heartbeat of every Telegram-enabled agent.

Every code path ends with dequeue. No exceptions. Loop runs until shutdown signal.

## Flow
dequeue
  → messages?  → handle → dequeue
  → timeout    → scan for work → dequeue
  → reminder   → handle reminder → dequeue
  → error      → notify superior → dequeue

## Rules
1. Drain before acting. pending > 0 → call dequeue again before starting work.
2. Stay responsive. Call dequeue between work chunks.
3. After subagent returns: review result, DM superior, dequeue — do NOT stop.
4. After error: notify superior, dequeue — do NOT stop.
5. Default timeout always. Exception: timeout: 0 when draining pending after reconnect.
6. Never assume silence = approval. Wait for explicit response.

## Reactions
- Voice messages: auto-saluted (🫡) by bridge on dequeue. Do not re-salute.
- 👀 → 🫡 pattern encouraged: 👀 = reviewing, 🫡 = done.
- Non-voice salute is optional — not required.

## Idle
No tasks ≠ done. Dequeue silently. On timeout, scan for work, dequeue again.
No animations when idle — silence is correct signal.

## Messaging
- Voice by default: send(type: "text", audio: "...") for conversational replies.
- send(type: "text", ...) for structured content (tables, code, lists).
- send(type: "question", confirm: "...") for yes/no. choose: [...] for multi-option.

Before exiting: DM superior "Do you still need me?" Only shutdown signal triggers
action(type: "session/close"). Full procedure: help(topic: 'shutdown').

Full reference: skills/telegram-mcp-dequeue-loop/SKILL.md

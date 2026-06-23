Dequeue Loop — Heartbeat of every Telegram-enabled agent.

Every code path ends with dequeue. No exceptions. Loop runs until shutdown signal.

## Flow
dequeue
  → messages?  → handle → dequeue
  → timeout    → scan for work → dequeue
  → reminder   → handle reminder → dequeue
  → error      → notify superior → dequeue

## Rules
1. Loop exit is timed_out: true only. pending > 0 → call dequeue again; pending == 0 is NOT the exit — keep calling dequeue() until timed_out: true. After any send, call dequeue() again immediately.
2. Stay responsive. Call dequeue between work chunks.
3. After subagent returns: review result, DM superior, dequeue — do NOT stop.
4. After error: notify superior, dequeue — do NOT stop.
5. Never assume silence = approval. Wait for explicit response.

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

## suppress_pending_hint flag

When the `suppress_pending_hint` flag is set on a session, the `hint` field is omitted from all dequeue responses. Affected hints include:
- Pending-queue nudge (`pending=N; use processing preset.`)
- Voice backlog hint (`N voice msg pending — react with processing preset.`)
- Silence hint

The `pending` count is **never** affected — only the advisory `hint` field is suppressed.

**Default behavior:** Hints are shown when relevant (flag absent or `false`).

**Persisting the flag via profile/save:**
1. Load a profile that includes `"suppress_pending_hint": true` (set via `profile/load`).
   - Or manually add the field to the profile JSON file: `data/profiles/{key}.json`.
2. Once the flag is on the session, `profile/save` will persist it along with all other settings.

**Removing the flag:** Load a profile with `"suppress_pending_hint": false`, or manually set the field to `false` in the profile JSON. Omitting the field from a profile leaves the session value unchanged (sparse merge).

Related: profile/load, profile/save, profile/import

Full reference: skills/telegram-mcp-dequeue-loop/SKILL.md

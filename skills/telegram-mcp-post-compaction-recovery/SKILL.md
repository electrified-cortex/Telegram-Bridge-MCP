---
name: telegram-mcp-post-compaction-recovery
description: >-
  Recovery procedure after context compaction in a Telegram bridge MCP session.
  Use when an agent resumes after compaction and needs to re-establish its
  Telegram connection without disrupting the operator.
compatibility: "Requires Telegram MCP bridge"
---

# Telegram MCP Post-Compaction Recovery

Compaction truncates conversation history but does NOT kill Telegram session. Session survives — recover token and re-enter loop.

## Critical Rule

**Do NOT call `action(type: "session/start")` or `action(type: "profile/load")` unless session is dead.**

- `session/reconnect` sends operator a reconnect prompt — unnecessary if session alive.
- `profile/load` overwrites preserved session settings (voice, speed, animations, reminders).

## Procedure

### Step 0: Check for Forced-Stop (First)

Read session memory file (e.g., `memory/telegram/session.md`):

| Condition | Action |
|-----------|--------|
| Empty or missing | Fresh start — skip to Step 1 |
| Has token, **no checkpoint block** | Compaction recovery — continue to Step 1 |

> **Workers:** Checkpoint block in session file → assume forced-stop (unless clean `close_session` recorded). Follow `telegram-mcp-forced-stop-recovery` for announcement, then return to Step 1 to reconnect.

If forced stop detected: announce to Curator per `telegram-mcp-forced-stop-recovery` (use `⚠️ Forced-stop recovery` prefix). Then continue with Step 1.

---

> **PostCompact context injection:** PostCompact hook injects recovery prompt as `additionalContext`. If present, call `action(type: "message/history", count: 5)` to retrieve recent Telegram context before re-entering loop.

1. **Read session memory for token.** Get token (single integer). File absent → fall back to conversation summary.

2. **Test session with animation** (see **animation-signaling-protocol**):

   ```text
   send(type: "animation", preset: "thinking", token: <your_token>)
   ```

   Succeeds → session alive. Skip to step 5.

3. **Session dead:** ONLY THEN reconnect:

   ```text
   action(type: "session/reconnect", name: "<AgentName>")
   ```

   Save new token to session memory.

4. **If reconnecting, reload profile** (old session state gone):

   ```text
   action(type: "profile/load", key: "<ProfileKey>")
   ```

5. **Check missed messages.**

   PostCompact context injected + already called `message/history` → skip to step 6.

   Otherwise: `get_chat_history`

6. **Duplicate prevention.** Before responding to history messages, check whether your SID already has recent outbound message replying to same message ID. If so, skip — already responded before compaction.

7. **Drain pending + re-enter loop:**

   ```text
   dequeue(timeout: 0)
   ```

   Then resume normal `dequeue` calls.

## Why This Matters

Compaction happens automatically at context limit — mid-conversation, mid-task, or idle. Recover without:
- Bothering operator with unnecessary reconnect prompts
- Losing voice/animation settings via redundant `load_profile`
- Double-responding to already-handled messages
- Silently dying without credentials

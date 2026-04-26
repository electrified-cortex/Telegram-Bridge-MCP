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

Read session memory file (e.g., `memory/telegram/session.token`). The file contains a plain integer token — no frontmatter, no checkpoint blocks:

| Condition | Action |
|-----------|--------|
| File empty or missing | No active session — skip to Step 3 to reconnect |
| File contains a valid integer | Token found — proceed to Step 1 to test liveness |

> **Workers:** If the token is absent and no clean `close_session` was recorded, treat as a potential forced-stop. Follow `telegram-mcp-forced-stop-recovery` for announcement, then proceed to Step 3 to reconnect.

---

1. **Read session memory for token.** Get token (single integer).

2. **Test session liveness with a silent probe:**

   ```text
   dequeue(max_wait: 0, token: <your_token>)
   ```

   - No error response (updates or empty) → session alive; drain any returned updates, then proceed to Step 5.
   - Error with `session_closed` → session dead, proceed to Step 3.

3. **Session dead:** ONLY THEN reconnect:

   ```text
   action(type: "session/reconnect", name: "<AgentName>")
   ```

   Save new token to session memory.

4. **If reconnecting, reload profile** (old session state gone):

   ```text
   action(type: "profile/load", key: "<ProfileKey>")
   ```

5. **Check missed messages** (skip if Step 2 returned updates — those are already in context).

   If Step 2 returned `{ empty: true }`, call `get_chat_history` to retrieve context that arrived during the compaction gap.

6. **Duplicate prevention.** Before responding to history messages, check whether your SID already has recent outbound message replying to same message ID. If so, skip — already responded before compaction.

7. **Drain pending + re-enter loop:**

   ```text
   dequeue(max_wait: 0)
   ```

   Then resume normal `dequeue` calls.

## Why This Matters

Compaction happens automatically at context limit — mid-conversation, mid-task, or idle. Recover without:
- Bothering operator with unnecessary reconnect prompts
- Losing voice/animation settings via redundant `load_profile`
- Double-responding to already-handled messages
- Silently dying without credentials

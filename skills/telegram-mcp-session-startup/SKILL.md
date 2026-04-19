---
name: telegram-mcp-session-startup
description: >-
  Cold-start procedure for joining the Telegram bridge MCP chat.
  Use when an agent needs to establish a new Telegram session from scratch —
  not after compaction (see telegram-mcp-post-compaction-recovery).
compatibility: "Requires Telegram MCP bridge"
---

# Telegram MCP Session Startup

Bootstrap new Telegram bridge session. All Telegram-enabled agents follow same steps with per-agent variations noted below.

> **v6 API:** All bridge operations via unified `action()` dispatcher. Call `help()` for overview, `help(topic: 'guide')` for full guide, `help(topic: 'action')` for dispatcher reference.

## Quick Start — First 2 Calls

| Call | Purpose |
| ---- | ------- |
| `help()` | Get tool index and overview |
| `action(type: "session/start", name: "<Name>")` | Join chat, get token |

## Procedure

### 0. Session File Check

Check **session memory file** (name specified in agent instructions or spawn prompt — e.g., `session.md`, `telegram/session.md`).

| Condition | Action |
| --- | --- |
| **No file or empty** | Clean start — continue to step 1 |
| **File has token** | Ask human: *"Found existing session (token X). Resume, wipe, or exit?"* |

Human chooses:
- **Resume** — use saved token. Skip to step 4. Verify alive with `send(type: "animation", ...)`. If dead → clean start.
- **Wipe** — overwrite file with empty, then clean start (step 1).
- **Exit** — stop immediately.

**Unattended startup** (spawned via script): Token exists → attempt resume automatically. Verify alive with animation. If alive → skip to step 4. If dead → clean start without prompting.

### 1. Learn the API.

   ```text
   help → help(topic: 'guide')
   ```

   Mandatory — API may have changed since last session.

2. **Join chat.**

   ```text
   action(type: "session/start", name: "<AgentName>", color: "<ColorEmoji>")
   ```

   Use agent display name. Pass `color` if agent file specifies one.

   **Session name constraints** (`INVALID_NAME` error on violation):

   | Rule | Detail |
   | ---- | ------ |
   | Allowed characters | Letters (`A-Z`, `a-z`), digits (`0-9`), spaces only |
   | Regex | `^[a-zA-Z0-9 ]+$` |
   | Empty / whitespace-only | Rejected |
   | Hyphens (`-`) | **Not allowed** |
   | Underscores (`_`) | **Not allowed** |
   | Emoji | **Not allowed** |
   | Non-Latin Unicode | **Not allowed** |
   | Collision | Rejected if another active session has same name (case-insensitive) |

   | Name | Valid? |
   | ---- | ------ |
   | `Worker 1` | ✅ |
   | `Claw Expert` | ✅ |
   | `Curator` | ✅ |
   | `Worker-1` | ❌ (hyphen) |
   | `Worker_1` | ❌ (underscore) |
   | `🤖 Worker` | ❌ (emoji) |
   | ` ` | ❌ (whitespace only) |

   Returns `{ token, sid, pin, sessions_active, action, pending }`. **`token` = identity for ALL subsequent calls.** `token = sid * 1_000_000 + pin`. `target_sid` always integer.

3. **Save token to session memory immediately.**

   ```text
   Token: <your token>
   SID: <your SID>
   Name: <AgentName>
   Started: <timestamp>
   ```

4. **Identify chain of command.**

   ```text
   action(type: "session/list")
   ```

   - **Curator:** Governor. Note who's online.
   - **Overseer:** Find Curator. If absent, operator is boss.
   - **Worker:** Find Overseer (or Curator if no Overseer).
   - **Specialist:** Find governor, DM you're online.

5. **Announce.** DM superior:
   - Overseer → Curator: *"Overseer online — scanning pipeline."*
   - Worker → Overseer: *"Worker $Id online — standing by."*
   - Specialist → Governor: *"Claw Expert online — reading handoff."*

6. **Load profile.**

   ```text
   action(type: "profile/load", key: "<ProfileKey>")
   ```

   Restores voice, animation presets, reminders. If profile doesn't exist: `action(type: "profile/import")` from `profiles/<ProfileKey>.json`, then `action(type: "profile/save", key: "<ProfileKey>")`.

7. **Enter loop** (see **telegram-mcp-dequeue-loop**).

   ```text
   dequeue
   ```

> **Stay in the loop.** If you have an active Telegram session, never exit the
> dequeue loop. Write this to session memory at startup so it survives compaction.

## Agent-Specific Notes

- **Curator:** Assume stale context. Read `changelog/` and recent session logs before loop.
- **Claw Expert:** After step 6, read handoff (`docs/handoffs/claw-expert-latest.md`) before loop.
- **Worker:** Memory filename and agent name suffix (`$Id`) come from spawn prompt. Use exactly.

## Gotcha: Session Name Format

Bridge rejects invalid names with `INVALID_NAME` (no detail). Rule: **letters, digits, spaces only** — no hyphens, underscores, emoji.

- `Worker 1` ✅  `Worker-1` ❌  `Worker_1` ❌

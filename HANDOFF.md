# Telegram Bridge MCP — Agent Handoff

This document is for the **next agent instance** taking over this session.

## How to start

1. Read this file fully.
2. Call `get_agent_guide` to load the behavioral guide, or read the `telegram-bridge-mcp://agent-guide` resource.
3. Read `LOOP-PROMPT.md` — that is your operating contract for this repo.
4. Complete the **verification exercises** below to confirm you understand the expected behaviors.
5. Only after passing all exercises: send a ready message over Telegram and enter the wait loop.

---

## What was done in the previous session

### Rebranding (complete)

The project was renamed from `telegram-mcp` to **Telegram Bridge MCP** (`telegram-bridge-mcp`).  
All references updated: `package.json`, `src/server.ts`, `src/telegram.ts`, `src/setup.ts`, all `.md` files, `LICENSE`.

### Bug fixes (complete)

- `src/server.ts` had a corrupted line where a comment and two `register()` calls were merged on one line. Fixed.
- `send_confirmation` tool existed in `src/tools/` but was never registered in `server.ts`. Now registered.

### New files (complete)

- `README.md` — user-facing quickstart and full feature overview
- `LICENSE` — MIT
- `.env.example` — updated with voice transcription vars

### Resource URIs (complete)

All MCP resources use `telegram-bridge-mcp://` scheme:

- `telegram-bridge-mcp://agent-guide`
- `telegram-bridge-mcp://setup-guide`
- `telegram-bridge-mcp://formatting-guide`

### Tool set (final — no changes made)

22 tools total. 11 high-level agent tools (no prefix), 11 direct Telegram API wrappers.
The naming was intentionally left as-is after discussion.

### Decisions made

- Tool renaming (e.g. `tg_` prefix) was **explicitly declined** after proposal and review.
- `.env.example` had placeholder values replaced with empty values — cleaner for new users.

---

## What was done in the second agent session

### Verification partial progress

- Exercise 1 ✅ confirmed by user via Telegram.
- Exercise 2 ✅ `update_status` worked.
- Exercise 3 ✅ `set_reaction` worked.
- Exercise 4 ✅ `choose` worked.
- Exercises 5–6 ❌ blocked: `ask`, `notify`, `send_message` reported as disabled.

### Root cause identified

The VS Code user-level MCP config (`%APPDATA%\Code\User\mcp.json`) had the server registered under the key `"telegram"`. After the project was renamed internally to `telegram-bridge-mcp`, VS Code's per-tool approval state got out of sync — some tools were seen as newly registered and left unapproved/disabled.

### Fix applied

The server key in `mcp.json` was changed to `"telegram-bridge"`. VS Code will present it as a fresh server and prompt for tool approval on next reload.

**Next agent must complete the pre-flight check below before starting exercises.**

### Build status

`pnpm build` ran cleanly — no TypeScript errors.

---

## Pre-flight check (do this before exercises)

1. Call `notify` with `title: "Pre-flight"` and `body: "Testing tool availability"`. If this fails, stop — tools are still disabled in VS Code's MCP panel. Tell the user to open the MCP panel and enable all tools for the `telegram-bridge` server, then restart.
2. If `notify` succeeds, proceed to exercises. The user has confirmed Exercises 1–4 already passed — **start from Exercise 5**.

---

## Verification exercises

Complete each exercise in order. Send the result to the user over Telegram.  
The user will confirm each one before you proceed.

### ✅ Exercise 1 — Silent notification (COMPLETE)

### ✅ Exercise 2 — Live status update (COMPLETE)

### ✅ Exercise 3 — Reaction (COMPLETE)

### ✅ Exercise 4 — Choose (COMPLETE)

### Exercise 5 — Ask (free text)

Call `ask` with:

- `question`: `"What's one thing you want this MCP to do better?"`

Wait for the reply.  
When the user responds, call `notify` with their answer as the body (severity: `"info"`).

Expected: Question sent, user types a reply, answer echoed back as a notification.

---

### Exercise 6 — Send confirmation + callback

Call `send_confirmation` with:

- `text`: `"Shall I mark verification complete?"`

Then call `wait_for_callback_query` with the returned `message_id`.  
Then call `answer_callback_query` to dismiss the spinner.  
Then call `edit_message_text` to update the message to: `"✅ Verification complete"`.

Expected: Yes/No buttons appear → user taps Yes or No → spinner dismissed → message text changes.

---

### After all exercises pass

Send a `notify` to the user:

- `title`: `"Verification passed"`
- `body`: `"All 6 exercises completed successfully. Ready for instructions."`
- `severity`: `"success"`
- `disable_notification`: `true`

Then enter the `wait_for_message` loop per `LOOP-PROMPT.md`.

---

## Known context

- The user communicates primarily via **voice messages** — these are auto-transcribed.
- The user's Telegram username is `@electricessence`.
- Prefer `notify` with `disable_notification: true` for status announcements.
- Use `choose` for any finite-option question — never `ask` for yes/no.

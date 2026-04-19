Session Dump Handling — Filing Telegram session dump documents.

Session dumps = conversation history as JSON. File promptly — no data lost between sessions.

## Reaction Protocol
✍ (pencil) — set immediately when processing begins.
🫡 (salute) — set when fully filed (replaces ✍).

## Inline (Reactive) Filing
When dump document event appears in dequeue:
1. React ✍ on dump message.
2. download_file the document.
3. Save to logs/telegram/YYYYMM/DD/HHmmss/dump.json
   Use dump's own timestamp (real seconds, not message ID).
4. Stage and commit: git add logs/telegram/<path>
   Commit message: docs: file telegram dump YYYY-MM-DD
5. React 🫡 on dump message.

Pre-approved operation — non-destructive, no confirmation needed.

## Periodic (Proactive) Filing
On recurring dump-check reminder:
1. List logs/telegram/ → find most recent filed dump.
2. get_chat_history → scan for document messages newer than last filed dump.
3. Download and file unfiled dumps (✍ → 🫡 on each).
4. Single commit for all new dumps:
   docs: file N telegram dumps from YYYY-MM-DD

Catches dumps missed while agent was dead, compacted, or offline.

## Path Convention
logs/telegram/YYYYMM/DD/HHmmss/dump.json
Use dump's creation timestamp, not current time.

Full reference: skills/telegram-mcp-dump-handling/SKILL.md

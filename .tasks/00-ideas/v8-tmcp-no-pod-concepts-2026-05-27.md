---
captured: 2026-05-27
source: operator voice (Telegram, msg 62572)
---

# CRITICAL: TMCP Skills Must Be Harness-Agnostic

## Operator statement (verbatim)

"Just a note, and I'm going to re-emphasize this, anything in-- when it comes to Telegram MCP, it has no notion of what we call pods. In fact, it might not even be Claude Code that's running. Okay, keep that in mind. There shouldn't be anything Claude Code specific in Telegram MCP. Telegram MCP is a tool that other agent harnesses use. I need to really emphasize that."

## What this means for TMCP skills

- No "pod" terminology
- No "memory/telegram/session.token" path references (pod file layout)
- No "inbox/monitor.sh" references (pod-specific script)
- No "session-end skill" references (Claude Code skill system)
- No "Claude Code" specific harness assumptions
- No "pod root" as CWD concept

## What to use instead

- "session token" (abstract — however the harness stores it)
- "your working directory"
- "your harness's shutdown procedure" / describe generically
- Activity monitor: use ACTIVITY_FILE_MONITOR_INSTRUCTIONS — that's TMCP-native
- Closeout: describe what to do (drain, close session) without referencing specific skills

## Implication for telegram-participation spec

v4 still has multiple violations:
- R1: `memory/telegram/session.token` → "your stored session token"
- R6: `inbox/monitor.sh` → REMOVE entirely (pod-specific)
- R9: "invoke session-end skill" → replace with generic closeout steps
- Definitions: "pod root" → remove
- Constraints: "Pod root must be CWD" → remove or generalize

This means v5 will be shorter and cleaner — removing pod scaffolding makes the TMCP contract more visible.

# TMCP SSE Notification Efficiency Investigation

**Filed:** 2026-06-20  
**Source:** Operator directive — "Telegram is a hot item right now"  
**Priority:** Hot

## Problem

Agent wakes on every bridge SSE event, including service/system messages that don't require immediate action (compaction events, modality hints, behavior nudges, reminders). This burns tokens and Opus context budget unnecessarily.

Rough ratio this session: ~10 real user messages vs ~8+ service-event wakes.

## Investigation axes

1. **Bridge-side filtering** — only emit `data: notify` for user messages and true message notifies, not system service events
2. **Agent-side dequeue threshold** — check routing before waking fully (e.g., skip processing if routing=ambiguous and all items are service_message)
3. **SSE event categorization** — classify events by urgency tier at bridge level; surface lower-urgency events on a coalesced/batched basis

## Scope note

Touches TMCP (shared repo) — requires operator approval before any changes.

## Next step

Design spec + impact estimate → operator review → impl


---
_Archived 2026-06-26 by audit — shipped (v7.13–7.18) or promoted into epics 10-3001/10-3017._

**Signed-off-by:** Claude Opus 4.8 — closure verified via task-board audit (subagent-assisted) against `src/` + `git log` on 2026-06-26.

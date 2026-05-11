---
title: "Rename `kick` to `nudge` or `bump` in TMCP terminology"
type: refactor
priority: 50
status: idea
created: 2026-05-05
filed-by: Curator
target_repo: telegram-bridge-mcp
---

# Rename `kick` (activity-file mtime touch) to `nudge` or `bump`

## Operator framing (2026-05-05, msg 50374)

> "Here's a task for the next version. We might want to think about renaming something from 'kick' to maybe 'nudge' or 'bump' or something, because 'kick' sounds like you're actually kicking someone out of the chat. So, just, I don't mind right now, it's not urgent. Put it on the backlog."

## Concept

Current TMCP terminology uses "kick" for the activity-file mtime touch (the signal that nudges Curator to dequeue). E.g., `nudgeArmed`, debounce/kick state machine, etc.

Connotation problem: "kick" semantically also means "remove from chat / kick a user out." Confusing for new users reading TMCP code or service messages.

## Goal (next version, not 7.4)

Survey current uses of "kick" across TMCP source + docs + service messages. Rename to either:

- **`nudge`** (already used in some places — `nudgeArmed`)
- **`bump`** (alternative — file-touch as "bumping" the mtime)

Pick one consistently. Update:

- Source identifiers (functions, fields, types).
- Service message text.
- Documentation (help topics, README).
- Task/spec references.

## Out of scope

- Changing the underlying mechanism. Pure rename.
- Renaming "session close / disconnect" terminology (different meaning).

## Priority

Backlog. Operator said "not urgent" — wait for next version cycle (post-7.4) and bundle with other naming/cleanup work.

## Bailout

- If "kick" appears in public-facing API surface (e.g., MCP action paths), renaming is breaking. Need a deprecation path. Surface back if scope explodes.

## Notes

- Active terms to consider: `nudgeArmed`, `kickDebounce`, `lastKickAt`, `kickCount`, etc.
- `nudge` already partially established in the codebase — leaning toward consolidating on it.

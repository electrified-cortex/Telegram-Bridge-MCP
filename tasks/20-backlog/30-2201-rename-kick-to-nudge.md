---
Created: 2026-05-05
Status: backlog
Priority: low
Source: operator voice 2026-05-05 msg 50374
---

# Rename `kick` (activity-file mtime touch) to `nudge`

## Problem

TMCP uses "kick" for the activity-file mtime touch signal (e.g. `kickDebounce`, `lastKickAt`, `kickCount`). The word "kick" also means removing a user from a chat, creating confusion when reading TMCP source, service messages, or docs. Operator noted (voice msg 50374, distilled) that "kick" sounds like removing someone from the chat.

`nudge` is already partially established in the codebase (`nudgeArmed`) and better describes the intent.

## Acceptance Criteria

- [ ] Survey all uses of "kick" (as the mtime-touch signal) across `src/`, tests, docs, service messages, and help topics.
- [ ] Rename to `nudge` consistently: identifiers, service message text, documentation.
- [ ] If "kick" appears in any public-facing API surface (MCP action paths), design a deprecation path and surface for review before renaming — do not silently break callers.
- [ ] All tests pass after rename.
- [ ] No renames touch "session close / disconnect" terminology (different concept).

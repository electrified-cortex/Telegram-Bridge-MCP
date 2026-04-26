---
id: 15-0843-help-shutdown-canonical-governor-procedure
title: help('shutdown') must carry the canonical governor procedure verbatim
priority: 15
status: draft
type: doc-fix
delegation: worker
---

# help('shutdown') — canonical governor procedure must be carried verbatim

## Problem

`action.help(topic: 'shutdown')` returns the contents of `docs/help/shutdown.md`. The doc has a Governor Shutdown section but the operator-recited procedure is the source of truth and the doc should match it verbatim, not paraphrase. Today an agent quizzed on the procedure can recite the broad strokes from `help('shutdown')`, but the exact step ordering (especially the wipe-token-before-shutdown invariant and the optional session/close-if-last detail) is fuzzy.

## Operator-stated canonical sequence (governor / Curator)

1. Drain queue: `dequeue(max_wait: 0)` until empty.
2. Wipe session memory file (token).
3. DM each remaining session: "Shutting down — close your session."
4. Wait for `session_closed` events.
5. Write session log to `logs/session/YYYYMM/DD/HHmmss/summary.md`.
6. Commit: `git add` session log + pending changes.
7. Acknowledge operator (brief voice).
8. `action(type: "shutdown")` — triggers MCP bridge graceful shutdown.

Operator-stated nuance (recorded in handoff 2026-04-26, repeated 2026-04-26 quiz turn):

- Wipe token BEFORE calling `shutdown`.
- If last session, governor may need `action(type: "session/close", force: true)` after `shutdown` signals close. Today's `docs/help/shutdown.md` does not document this final step explicitly for the governor case.

## Acceptance

- `docs/help/shutdown.md` Governor Shutdown section matches the operator-stated sequence verbatim.
- Wipe-token-before-shutdown invariant is explicit (callout or numbered ordering).
- Last-session `session/close(force: true)` step is documented if it is in fact required (verify against bridge behavior — operator said "we'll work out the nuances later").
- `help('shutdown')` returns the updated text. Test in `src/tools/help.test.ts` confirms the section heading + key steps.

## Don'ts

- Don't paraphrase. The operator wants this verbatim so any agent quizzed mid-session can recite it identically to the doc.
- Don't merge Common + Governor sections — they diverge intentionally.

## Notes

- Filed at operator request 2026-04-26 after Curator quiz turn.
- Ties into recently-sealed 10-0830 graceful-shutdown skill — keep the SKILL.md and docs/help/shutdown.md aligned.

---
id: 15-0843-help-shutdown-canonical-procedure
title: help('shutdown') must carry the canonical procedure (participant + governor) verbatim
priority: 15
status: done
type: doc-fix
delegation: worker
---

# help('shutdown') — canonical procedure (participant + governor) must be carried verbatim

## Problem

`action.help(topic: 'shutdown')` returns the contents of `docs/help/shutdown.md`. Agents should NOT need an external skill to know how to participate in a shutdown — the TMCP help text is the canonical source of truth and must be self-contained. The operator-recited procedure is the source of truth and the doc should match it verbatim, not paraphrase.

Two distinct flows must be documented separately:

1. **Participant flow** — for any agent that is NOT the governor.
2. **Governor flow** — for the single agent authorized to invoke `shutdown` on the bridge.

## Operator-stated principles (2026-04-26 PM)

- Shutdown is a TMCP-level concept. Agents must be able to act on it from `help('shutdown')` alone, no skill required.
- Only the **governor** can call `action(type: "shutdown")`. Participants cannot.
- `shutdown` is NOT death for the calling agent. The agent process continues running after the bridge stops; it can still write files, commit, and produce a handoff doc.
- Handoff docs are **extra** — not part of the bridge shutdown. The governor MAY write a handoff before OR after invoking `shutdown`. (Curator currently does it before; that's a Curator preference, not a TMCP requirement.)
- The governor does NOT call `session/close` on itself before `shutdown`. `shutdown` is the governor's analogue of `session/close` — it tears down the whole bridge, including the governor's session.

## Participant procedure (canonical)

When the governor DMs you "Shutting down — close your session" (or you decide to close early):

1. Wipe your session token from your memory file (`memory/telegram/session.token`).
2. `action(type: "session/close")` — releases your SID.
3. Optional: write a handoff doc and commit. (Token is already wiped; you are no longer connected to the bridge.)

## Governor procedure (canonical sequence)

1. Drain queue: `dequeue(max_wait: 0)` until empty.
2. Wipe session memory file (token).
3. DM each remaining session: "Shutting down — close your session."
4. Wait for `session_closed` events from each participant.
5. Write session log to `logs/session/YYYYMM/DD/HHmmss/summary.md`.
6. Commit: `git add` session log + pending changes.
7. Acknowledge operator (brief voice).
8. `action(type: "shutdown")` — triggers MCP bridge graceful shutdown. This is the governor's analogue of `session/close`; do NOT call `session/close` on yourself first.

Operator-stated invariants:

- Wipe token BEFORE calling `shutdown`.
- If a participant fails to close cleanly, governor may need `action(type: "session/close", force: true, target_sid: N)` before invoking `shutdown` (verify against bridge behavior — operator said "we'll work out the nuances later").
- Handoff doc is OPTIONAL and may be written AFTER `shutdown` (the agent process is still alive). Curator's habit is to write it before — that is a Curator preference, not a TMCP requirement.

## Acceptance

- `docs/help/shutdown.md` has two clearly-labeled sections: **Participant Shutdown** and **Governor Shutdown**, each matching the operator-stated sequence verbatim.
- Doc explicitly states: only the governor can call `action(type: "shutdown")`.
- Doc explicitly states: `shutdown` is the governor's `session/close` analogue — governor does NOT call `session/close` on self.
- Doc explicitly states: agent is NOT dead after `shutdown`; handoff is optional and may be written after.
- Wipe-token invariant is explicit and ordered correctly in both flows.
- `help('shutdown')` returns the updated text. Test in `src/tools/help.test.ts` confirms both section headings + key steps.

## Don'ts

- Don't paraphrase. Operator wants verbatim so any agent quizzed mid-session can recite identically to the doc.
- Don't merge Participant + Governor sections — they diverge intentionally.
- Don't tell governor to call `session/close` on itself before `shutdown` — wrong; `shutdown` IS the governor's close.
- Don't tell agents they need a skill to handle shutdown — `help('shutdown')` must stand alone.
- Don't conflate handoff-writing with the bridge shutdown — handoff is optional and unrelated to bridge teardown timing.

## Notes

- Filed at operator request 2026-04-26 after Curator quiz turn; enriched 2026-04-26 PM with participant-vs-governor split + handoff-is-extra clarification.
- Ties into recently-sealed 10-0830 graceful-shutdown skill — but per operator, the SKILL should ultimately be made unnecessary by a complete `help('shutdown')`. Keep aligned for now; long-term the skill becomes redundant.

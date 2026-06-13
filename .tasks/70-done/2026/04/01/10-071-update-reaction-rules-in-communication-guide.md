# Task: Update Reaction Rules in Communication Guide

**Created:** 2026-04-01
**Status:** completed
**GitHub Issue:** n/a (operator feedback)

## Objective

Refine the `set_reaction` / 👀 rules section in `docs/communication.md` to
better reflect desired agent behavior.

## Context

Operator feedback (2026-04-01): agents were applying permanent 👀 reactions to every
message as blanket acknowledgement. The guide already says 👀 should be temporary, but
agents weren't following it consistently. Operator clarified desired behavior:

- **All acknowledgement reactions must be `temporary: true`** — 👀, 👍, 🫡, 🤔.
- **👀 on text is fine** — contradicts current guide rule "Avoid on text." Remove that rule.
- **Don't react to every message** — 👀 is for genuinely focused attention, not blanket ack.
- **🤔 (thinking)** is encouraged for messages being actively processed / considered.
- **Pairing reactions with animations** is good — e.g., 🤔 reaction + thinking animation.
- **Drain sequences** don't need reactions — when processing a backlog, skip reactions.

## Acceptance Criteria

1. Update the `👀 rules` table in `docs/communication.md`:
   - Remove "Avoid on text" rule.
   - Add guidance: "Use sparingly — for messages you're genuinely focused on, not blanket ack."
   - Add 🤔 as a recommended reaction for active thinking/processing.
   - Add guidance about skipping reactions when draining message backlogs.
2. Keep existing auto-restore and temporary behavior documentation intact.
3. No functional code changes — docs only.

## Completion

**Status:** complete
**Date:** 2026-04-01
**Worker:** Worker 2

Changed `docs/communication.md`:
- Hard Rule 6: removed "skip 👀 on text"; replaced with "use sparingly, not blanket ack; skip when draining backlog"
- Reactions table: added 🤔 entry
- Tool Selection table: added 🤔 to reactions row
- Reactions section: removed "skip 👀 on text entirely" bullet; added text bullet (allowed sparingly), backlog bullet (skip reactions), always-temporary bullet, and 🤔-for-thinking bullet
- Pipeline flow line: updated to `receive → think (🤔 + animation) → work → show_typing → send`

# TMCP Presence Nudge — Agent Contract Spec

**Source:** Operator (via Telegram, 2026-06-20)
**Status:** Spec — to be incorporated into agent operating doctrine and agent behavior guidelines

---

## What It Is

`behavior_nudge_presence_rung2` fires when an agent dequeued a message but showed NO presence signal afterward — no reaction, no animation, no typing, no reply.

The nudge is CORRECT behavior and must NOT be suppressed. It is the enforcement mechanism for the agent presence contract.

This is not a TMCP bug. It is not a spurious wake. It must not be excluded from SSE notify.

---

## Agent Presence Contract

After dequeuing ANY message, the agent MUST immediately show a presence signal. Acceptable signals (any one suffices):

- Post a reaction (e.g., 👀, ✅)
- Start an animation (working/thinking preset)
- Show a typing indicator
- Send a text reply or acknowledgment

Silence after dequeue violates the contract. The nudge fires to enforce it.

---

## Root Cause Pattern

Agent received a message → dequeued it → did nothing visible to the operator. The operator has no feedback that the message was received or acted upon. This is the problem the nudge addresses.

---

## Implementation Note

Any agent that calls `dequeue` must follow the dequeue immediately with one of the presence signals listed above. Failure to do so will trigger `behavior_nudge_presence_rung2`. The correct response to receiving this nudge is to emit a presence signal — not to investigate why the nudge fired.


---
_Archived 2026-06-26 by audit — shipped (v7.13–7.18) or promoted into epics 10-3001/10-3017._

**Signed-off-by:** Claude Opus 4.8 — closure verified via task-board audit (subagent-assisted) against `src/` + `git log` on 2026-06-26.

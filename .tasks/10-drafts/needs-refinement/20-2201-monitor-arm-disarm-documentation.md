---
Created: 2026-05-28
Status: backlog
Priority: medium
Source: operator voice 62948, 2026-05-28
---

# Simplify ARM/DISARM monitor documentation throughout TMCP

## Problem

Now that monitors are confirmed stable through compaction (they survive context resets without re-arming), the current TMCP help topics, skills, and agent guides still describe a verify-and-re-arm loop at recovery time. This loop is unnecessary, adds noise to recovery docs, and misleads agents into extra tool calls.

The correct pattern is simple:
- ARM at startup
- DISARM at graceful shutdown
- No re-arm needed at compaction recovery

Operator directive (voice 62948, distilled): documentation must clearly state how to arm a monitor at startup and how to disarm it at shutdown — that is the critical piece. The verification loop wastes agent time and energy when monitors are actually working.

`recovery.md` has already been simplified (commit c5150ee). Remaining work is the broader documentation sweep.

## Acceptance Criteria

- [ ] All TMCP help topics referencing monitor recovery or re-arming updated to reflect stable-monitor behavior.
- [ ] Agent guide / onboarding content updated: ARM at startup, DISARM at graceful shutdown, nothing at compaction recovery.
- [ ] Any skill files (telegram-participation, session-end, etc.) that include a verify-loop for monitor state updated to remove that loop.
- [ ] `help('compacted')` monitor section (see `30-2206`) aligned with stable-monitor fact — no re-arm step.
- [ ] No references to "re-arm after compaction" remain in TMCP-owned documentation.
- [ ] Verified: a fresh agent following the simplified docs successfully maintains monitor through a compaction cycle.

## Overseer bounce (2026-06-01)
- verdict: REJECT — ACs untestable, contradicts 30-2206
- finding: No file list (scope subjective). Conflates two meanings of "re-arm". Final AC ("fresh agent follows docs through compaction") is a live integration test with no harness or pass criteria. Contradicts 30-2206 (which adds re-arm steps) — these must be reconciled first.
- action: Enumerate specific files, clarify which "re-arm" concept is being simplified, add objective verification method, reconcile with 30-2206 before re-filing.

## Overseer analysis (2026-06-20)
30-2206 archived as resolved — `docs/help/compacted.md` already has comprehensive monitor recovery. Conflict resolved.

Remaining gap: the task's premise "monitors survive compaction without re-arming" conflates two distinct things:
- (a) **Watcher process**: survives compaction independently — `compacted.md` File-B/C correctly checks for this before deciding to restart
- (b) **Monitor TaskCreate subscription**: dies at compaction — agent must ALWAYS re-run `Monitor()` after compaction

The current docs are correct. "Nothing at compaction recovery" would be a regression. Curator must clarify:
1. Is this task specifically about removing the watcher-restart step (currently already conditional, not always triggered)?
2. Or is there a newer claim that even the Monitor TaskCreate subscription now survives compaction?
3. Or has this been superseded by the post-compact auto-recovery bridge feature?

Until Curator answers, this stays in needs-refinement.

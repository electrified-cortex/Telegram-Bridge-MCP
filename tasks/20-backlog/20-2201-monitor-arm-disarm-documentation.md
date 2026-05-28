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

Operator directive (voice 62948): "We definitely need to have some sort of way of saying, hey, here's how you arm your monitor. And that happens at startup. And then shut down, here's how you disarm it. That's the critical piece. The verification loop is waste of energy and time for agents if monitors are actually working."

`recovery.md` has already been simplified (commit c5150ee). Remaining work is the broader documentation sweep.

## Acceptance Criteria

- [ ] All TMCP help topics referencing monitor recovery or re-arming updated to reflect stable-monitor behavior.
- [ ] Agent guide / onboarding content updated: ARM at startup, DISARM at graceful shutdown, nothing at compaction recovery.
- [ ] Any skill files (telegram-participation, session-end, etc.) that include a verify-loop for monitor state updated to remove that loop.
- [ ] `help('compacted')` monitor section (see `30-2206`) aligned with stable-monitor fact — no re-arm step.
- [ ] No references to "re-arm after compaction" remain in TMCP-owned documentation.
- [ ] Verified: a fresh agent following the simplified docs successfully maintains monitor through a compaction cycle.

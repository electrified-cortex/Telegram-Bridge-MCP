---
Created: 2026-05-28
Status: backlog
Priority: medium
Source: operator voice 62895, 2026-05-27
---

# Rebuild `refresh.md` and `startup.md` for Telegram-participating pods

## Problem

Context files (`startup.md`, `refresh.md`) for Telegram-participating pods (Unit-12, Scout-7, Curator-remote, and template) are inconsistent and incomplete. They lack the envelope concept, correct Telegram reconnection logic, and clear sequencing. `recovery.md` has already been rebuilt and committed (c5150ee) — `refresh.md` and `startup.md` are the remaining pieces.

Operator directive (voice 62895): Refresh runs on startup AND after compaction (reminding + setup check). Startup holds the initial Telegram join sequence. Recovery already done. Duplication between startup/recovery is acceptable if adjusted for context. Use an envelope delimiter ("beginning reminder section") to bracket injected content.

## Design notes

- `refresh.md` — envelope concept: delimiter-wrapped reminder block. Covers: current session context, Telegram reconnection check, ensure monitors set up, communication verify.
- `startup.md` — Telegram join sequence: sign-on directive, activity file provision, Monitor arm, initial dequeue. References refresh.md for ongoing reminders.
- Both files are per-pod-class (Telegram class). Not universal agent files.

## Acceptance Criteria

- [ ] `refresh.md` rebuilt with envelope delimiters wrapping the reminder block.
- [ ] `refresh.md` covers: session context summary, Telegram reconnect check, monitor verify, communication readiness.
- [ ] `startup.md` rebuilt with explicit Telegram join sequence (sign-on, activity file, Monitor arm, initial dequeue).
- [ ] Both files consistent with the completed `recovery.md` (c5150ee) — no contradictions.
- [ ] Template pod updated with new `refresh.md` and `startup.md`.
- [ ] Telegam-class pods (Unit-12, Scout-7, Curator-remote) receive the updated files without trampling persona/memory/reminders.
- [ ] Operator reviews and approves both files before propagation.

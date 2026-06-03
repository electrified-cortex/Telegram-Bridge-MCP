---
id: 10-2108
title: "telegram-participation SKILL.md: fill R5 (activity monitor arm), R6 (verification), R8 gaps"
Created: 2026-06-03
Status: draft
Priority: medium
type: skill-amendment
Source: Overseer spec verification (telegram-participation-spec v11 vs shipped SKILL.md), 2026-06-03
Delegation: Worker
related: []
---

# Fix telegram-participation SKILL.md gaps vs v11 spec

## Background

Verification of the shipped telegram-participation SKILL.md against the v11-final spec
(curator-pod tasks/40-queued/telegram-participation-spec.md) found three substantive gaps.
The spec was marked PASS at v11 but the SKILL.md was not updated to reflect the full spec.

## Gaps to fix

### Gap 1 — R5 (Activity monitor arm): delegated without detail

Current SKILL.md delegates R5 to `help('startup')` without documenting the spec's branching:

- **Branch A (compaction recovery)**: `action(type: 'activity/file/get')` to retrieve
  surviving file_path; fall through to Branch B if no file_path.
- **Branch B (fresh start)**: `action(type: 'activity/file/create')`, then
  `dequeue(max_wait:10)` scanning for `ACTIVITY_FILE_MONITOR_INSTRUCTIONS` by event_type.
- **ALREADY_REGISTERED handling**: use `details.file_path` if non-empty; else
  `activity/file/delete` then `activity/file/create`.
- **Path construction**: if file_path contains backslash separators, convert to POSIX first.
  TMCP root = 3 parent directories up from file_path.
  Command: `<TMCP_root>/tools/monitor.sh <file_path>`.
- Stop any running watcher before arming.

### Gap 2 — R6 (Monitor verification): missing entirely

Neither SKILL.md version documents the verification step:
1. Send a self-DM to trigger an activity file update.
2. Wait up to 30s for the file watcher to emit. Signal → monitor live.
3. No signal → re-arm: `activity/file/delete` then `activity/file/create`; re-arm watcher.

### Gap 3 — R8 (Closeout): incomplete

Missing from current SKILL.md:
- Stop file watcher by retained handle first; if unavailable, `activity/file/delete`.
- Drain is capped at 10 iterations (not infinite).
- Token cleared (capture then clear) before `session/close`.
- `LAST_SESSION` → retry with `force: true`.
- R8 must run on ALL shutdown paths (not optional).

### Non-critical (R1): simplified connection mode matrix

Current R1 omits the "token present but TMCP unavailable" branch (→ Direct Connect + notify).
Add the complete decision matrix from the spec.

## Acceptance criteria

- [ ] AC1: R5 Branch A/B both documented in SKILL.md with explicit action calls.
- [ ] AC2: R5 ALREADY_REGISTERED handling documented.
- [ ] AC3: R5 path construction (backslash→POSIX, TMCP root derivation, monitor.sh command) documented.
- [ ] AC4: R6 monitor verification (self-DM, 30s wait, re-arm fallback) documented.
- [ ] AC5: R8 has: handle stop, 10-iteration drain cap, token clear, LAST_SESSION force retry.
- [ ] AC6: R1 connection mode matrix is complete (3 branches).
- [ ] AC7: `skill-auditing` pass on the amended SKILL.md shows no HIGH findings for these gaps.

## Scope

- Only `telegram-participation/SKILL.md` (and uncompressed.md if applicable).
- Do NOT change R2, R3, R4, R7 (already implemented per gap analysis).
- Do NOT change the bridge's `help('startup')` — SKILL.md must document these steps

- Target file: stations/skills/telegram-participation/SKILL.md (stations canonical source). Changes staged here — do NOT sync to lectrified-cortex/skills/ (public plugin, operator-gated) without explicit approval.
  directly, not rely on help() for critical branching.
## Overseer review

- Reviewer: Overseer SID-3
- Date: 2026-06-03
- Verdict: PASS (v2 — file path corrected to stations canonical source, scope note added re: public plugin gate)
- Review type: adversarial dispatch + fix
- Checked: ACs binary and testable (7 items), scope bounded (SKILL.md only), reference spec present at curator-pod/tasks/40-queued/, correct target path (stations/skills/ not public skills/), standing gate respected (stage don't publish)
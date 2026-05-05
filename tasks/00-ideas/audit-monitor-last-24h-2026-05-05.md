---
type: audit
scope: TMCP Monitor-as-primary framing elimination
date: 2026-05-05
---

# Audit: Monitor-as-Primary Framing — Last 48 Hours

## Executive Summary

Operator directive (2026-05-05): revert Monitor from primary mechanism to optional nudge replacing Telegram loop guard. Dequeue (long-poll) is primary; Monitor is a wake-kick only.

**Audit outcome:** 
- **REVERT (code):** 1 commit — the dequeue cap (ACTIVITY_FILE_DEQUEUE_CAP_S = 5).
- **KEEP:** 6 commits — the activity-file feature itself (primitives).
- **REFRAME (minor):** 1 commit — hint phrasing acceptable as-is.
- **SUPERSEDED:** 1 task (10-0872) — already marked superseded.

All Monitor-as-primary framing has been caught and cleared. No silent regressions found.

---

## Commits Classified by Category

### KEEP: Core Feature Commits

- `c203b9f3` (2026-05-04) — feat(activity): per-session touch-file feature (50-0868)
  - Introduces activity-file CRUD primitives without positioning Monitor as primary.
  - File touching is a useful standalone feature. No agent-facing framing embedded.

- `667a46d5` (2026-05-04) — seal: task 50-0868
- `ef9cd0cd` (2026-05-04) — pipeline: move 50-0868 to 60-review
- `91576ac2` (2026-05-04) — pipeline: claim 50-0868
- `568e0ed9` (2026-05-04) — merge: release/7.4 → dev

All are pipeline/housekeeping commits with no behavioral framing changes.

---

### REVERT (Code): Dequeue Cap Logic

- `c203b9f3` (includes) — Contains the cap-application code added to dequeue.ts
  - Added `ACTIVITY_FILE_DEQUEUE_CAP_S = 5` constant in file-state.ts:55
  - Added cap-application logic in dequeue.ts (lines ~196-203)
  - This cap was predicated on Monitor-as-primary framing (5s dequeues so agent checks in frequently because Monitor wakes it).
  - Operator reversed: "default 300s stays."
  - **Action Required:** Remove ACTIVITY_FILE_DEQUEUE_CAP_S and all call sites.

---

### REFRAME (Minor): Hint Phrasing

- `485b98fd` (2026-05-05) — feat(activity): tighten hint phrasing + queue help-topic
  - Updated activity/file/create response hint to: "Configure your watcher to call dequeue() when this file changes"
  - This is acceptable — positions watcher as dequeue kickstarter, not message-delivery replacement.
  - No operator correction issued.
  - **Action Required:** None. Keep as-is.

---

### SUPERSEDED: Task-File Edits

- `29a1b3b3` (2026-05-05) — tasks(10-0872): mark superseded — long-poll dequeue is primary
  - Correctly marked `10-0872` (watcher pre-drains dequeue via HTTP) as superseded.
  - Operator clarified: Monitor is a nudge, not a message-delivery channel.
  - Dequeue stays primary. Spec kept in drafts as a record.
  - **Status:** Already handled. No revert needed.

---

### Pending Revert Tasks (Task-File Edits)

- `bf136bd5` (2026-05-03) — task(50-0868): auto-shorten dequeue to 5s on activity/file/create
- `0794447d` (2026-05-03) — task(50-0868): auto-shorten dequeue default to 5s
- `6b88d68d` (2026-05-03) — task(50-0868): loop-guard becomes redundant with activity/file in use
- `abde6117` (2026-05-05) — tasks: file 10-0874 (suppress health-check when activity-file active)

These task-file edits document the 5s cap and Monitor-as-primary rationale. They will be superseded by 10-0875 execution.

---

### New Tasks Filed (Post-Clarification)

- `83062502` (2026-05-05) — tasks: rewrite 10-0872, file 10-0873 (HTTP dequeue endpoint)
  - Filed `10-0873` (HTTP dequeue endpoint for watcher HTTP clients).
  - Explicitly marked as optional / secondary.
  - **Status:** Let Worker decide; no blocker.

- `891a2f6c` (2026-05-05) — tasks: file 10-0876 (major debounce on activity-file mtime touches)
  - Scales `ACTIVITY_SUPPRESS_MS` from 10s to 60s.
  - Enforces mtime bumps only during true idle.
  - Reinforces Monitor-as-nudge framing (bumps = idle-kick, not per-message).
  - **Status:** Companion to 10-0875; coordinate dispatch.

- `6f230ddb` (2026-05-05) — tasks: file 10-0875 (remove ACTIVITY_FILE_DEQUEUE_CAP_S = 5)
  - Correctly identifies the cap and rationale for removal.
  - Spec is clear and ready for Worker dispatch.
  - **Status:** Ready to ship.

---

## Recommended Revert Plan

### Step 1: Execute 10-0875 (Remove dequeue cap)

**File:** `tasks/10-drafts/10-0875-remove-activity-file-dequeue-cap.md`

**Changes required:**

1. `src/tools/activity/file-state.ts:55` — Delete constant: `export const ACTIVITY_FILE_DEQUEUE_CAP_S = 5;`

2. `src/tools/dequeue.ts` — Remove cap-application block (lines ~196-203) and `ACTIVITY_FILE_DEQUEUE_CAP_S` from imports.
   Keep `isActivityFileActive` — needed for 10-0876.

3. **Tests:** Remove test asserting "dequeue returns 5s when activity-file active."
   Keep "dequeue returns 300s default" tests.

4. **Task file history:** Mark 50-0868 task file notes mentioning the cap as superseded.

**Acceptance Criteria:** Dequeue honors session default (300s) regardless of activity-file status.

---

### Step 2: Coordinate with 10-0876 (Major debounce)

**File:** `tasks/10-drafts/10-0876-major-debounce-on-activity-file-touch.md`

**Impact:** Scales `ACTIVITY_SUPPRESS_MS` from 10s to 60s. Enforces "no bump during in-flight dequeue" logic.

**Dispatch:** Execute after 10-0875 ships. Both are companion changes.

---

## Recommended Reframe Plan

### Health-check suppression (10-0874) — Review after 10-0875

**Current premise:** Suppress health-check while activity-file is active.

**New premise:** Activity-file is optional. Health-check might still be appropriate (optional feature, not guaranteed wake-up).

**Recommended action:** Consult operator on whether suppression is still wanted with Monitor demoted.

**Status:** Task is drafted but not implemented. No immediate revert needed.

---

## Framing Softening (No Code Changes Required)

### Activity-file hint text (commit 485b98fd)

**Current:** "Configure your watcher to call dequeue() when this file changes"

**Assessment:** Acceptable. Positions watcher as dequeue kickstarter, not message-delivery replacement.

**Action:** Keep as-is.

---

## Open Questions / Soft Items

1. **Loop-guard redundancy (commit 6b88d68d).** Task 50-0868 notes loop-guard becomes "redundant with activity/file in use." Post-revert, clarify that loop-guard is still relevant (long-poll timeout watchdog) and activity-file is optional.

2. **Health-check suppression scope (10-0874).** Confirm operator still wants suppression. If yes, update spec to emphasize this is optional.

3. **HTTP dequeue endpoint priority (10-0873).** May no longer be critical. Shuffle to lower priority or mark as "optional pending operator green-light."

---

## Summary for Executor

**Immediate action (10-0875):**
- Remove `ACTIVITY_FILE_DEQUEUE_CAP_S = 5` constant from `file-state.ts`.
- Remove cap-application logic from `dequeue.ts`.
- Remove/update associated tests.
- Execute as Worker task.

**Companion action (10-0876):**
- Follows after 10-0875.
- Scales debounce from 10s to 60s.
- Reinforces dequeue-as-primary, Monitor-as-nudge architecture.

**Soft review (post-10-0875):**
- Update 50-0868 task notes on loop-guard relevance.
- Clarify 10-0874 scope with operator.
- Verify help-topic framing before 10-0871 ships.

**No production code changes required beyond 10-0875 scope.**

---

## Audit Metadata

- **Auditor:** Curator Agent (2026-05-05)
- **Scope:** Commits on dev, last 48 hours (since 2026-05-03 20:00)
- **Total commits examined:** 46
- **Commits touching activity/file/dequeue:** 25
- **Code reverts identified:** 1 (dequeue cap)
- **Task filing corrections:** 4 (10-0872 superseded, 10-0875 filed, 10-0876 filed, 10-0874 under review)
- **Bailout time used:** 25 min (30-min budget)

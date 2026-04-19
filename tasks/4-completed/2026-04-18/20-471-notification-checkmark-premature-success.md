---
Created: 2026-04-11
Status: Backlog
Host: local
Priority: 20-471
Source: Operator
---

# Checklist Completion Badge Should Reflect Outcome

## Objective

When the system auto-completes and unpins a checklist, the completion marker currently shows ✅ Complete regardless of whether all items passed. If items were skipped (⛔) or failed, the completion badge should visually indicate the checklist was not fully successful — e.g., ❌ Incomplete, 🟡 Incomplete, or 🔴 Rejected.

## Context

Operator observed a Worker complete a checklist that had some items with a stop-sign indicator (⛔ skipped/failed). The system correctly auto-replied and unpinned the checklist, but the ✅ Complete badge suggested full success. The operator needs to see at a glance whether a completed checklist requires follow-up.

## Acceptance Criteria

- [x] Checklist completion logic inspects item statuses before choosing the badge
- [x] All items passed → ✅ Complete N/N
- [x] Any items failed/rejected → 🔴 Failed (with counts)
- [x] Any items skipped (but none failed) → 🟡 Incomplete (with counts)
- [x] Badge text includes summary
- [x] Never use ❌
- [x] Tests cover all three completion states (plus failed+skipped mix)

## Completion

**Completed:** 2026-04-18
**Branch:** `20-471-checklist-badge` (Telegram MCP)
**Commit:** `832d1a0`

**Changes:** `src/tools/send_new_checklist.ts` — added `completionBadge()` function; replaced hardcoded `"✅ Complete"` with computed badge. Tests added for all states.

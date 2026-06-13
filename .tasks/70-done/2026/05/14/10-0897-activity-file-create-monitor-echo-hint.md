---
id: "10-0897"
title: "activity/file/create hint = literal call signature with token"
type: dx-fix
priority: 10
created: 2026-05-11
delegation: Worker
target_branch: dev
status: completed
claimant: foreman
worktree: .foreman-pod/.worktrees/10-0897
spawn_task: b11s32hd2
completed_at: 2026-05-14T23:23:00Z
---

# 10-0897 — activity/file/create hint = literal call signature with token

**Priority**: 10
**Type**: small DX fix
**Created**: 2026-05-11
**Delegation**: Worker

## Problem

`activity/file/create` `hint` field today points at HTTP docs. Agents
in IDE runtimes (Claude Code Monitor) need a literal one-liner they
can paste as the Monitor's stdout echo — so each wake notification
self-documents the next call.

## Fix

Set the `hint` field to the literal call signature, with the agent's
session token interpolated server-side:

```
"hint": "call dequeue(token: 1532424)"
```

Agent uses that string verbatim as their Monitor's echo. Done.

## File

`src/tools/activity/file-action.ts` (verify path) — substitute the
session token into the hint string at response time.

## Verification

**Verdict:** APPROVED
**Date:** 2026-05-14
**Verifier:** Dispatch sub-agent (fresh-eyes, read-only)
**Squash commit:** `213e1b7` on `dev`

All criteria confirmed:
- Both code paths in `src/tools/activity/create.ts` (lines 45, 68) return `call dequeue(token: ${sid})` with session token interpolated from `requireAuth`.
- Old HTTP-docs hints fully replaced (not augmented).
- Correct file identified (`create.ts`, not the draft-spec'd `file-action.ts`).

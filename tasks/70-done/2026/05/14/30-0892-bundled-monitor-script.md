---
id: "30-0892"
title: "bundled monitor script for agent inbox/activity-file watching"
type: feature
priority: 30
created: 2026-05-14
delegation: Worker
target_branch: dev
---

# 30-0892 — bundled monitor script for agent inbox/activity-file watching

## Context

Agents currently roll their own `inbox/monitor.sh` (file-mtime watcher) per pod. When that script dies (parent claude session crash, kill signal, OS-level cleanup), the agent goes deaf to file-based inbox changes with no fallback. Recurring failure mode — happened 2026-05-14 with Overseer.

A bundled, server-blessed monitor script — co-located with TMCP's other agent-facing scripts (`tools/`?) — would let agents call ONE canonical monitor instead of inheriting per-pod variants, and TMCP could harden it (auto-restart, health-check endpoint, etc).

## Acceptance criteria

1. TMCP ships an agent-callable monitor script (location: alongside existing dump scripts — confirm with operator on exact path).
2. Script watches the agent's activity file (path obtained via `activity/file/get`) and emits a kick line each time mtime changes.
3. Optional: emits a heartbeat line every N seconds so the agent can detect a dead monitor (no kicks AND no heartbeats = restart).
4. Update `telegram-participation` skill to use the bundled script instead of pod-local `inbox/monitor.sh`.
5. Document the script in TMCP README.

## Out of scope

- Migrating pod-local inbox/outbox monitors (those watch `.signal` files unrelated to TMCP). Separate concern.

## Variants

Ship both: `monitor.sh` (bash) and `monitor.ps1` (PowerShell). Same style as existing dump-script pair.

## Source

- Operator request 2026-05-14T21:42 UTC: "Telegram MCP should provide a monitor script that's part of the activity, in the same location as our dump scripts. Agents call that script for their monitor."

## Verification

**Verdict:** APPROVED
**Date:** 2026-05-14
**Verifier:** Dispatch sub-agent (fresh-eyes, read-only)
**Cherry-pick commit:** `5259c83c` on `dev`

All 5 acceptance criteria CONFIRMED:
- AC1: `tools/monitor.sh` added alongside dump scripts — `tools/monitor.sh:1` (#!/usr/bin/env bash)
- AC2: Watches argument path, emits `kick` on mtime change — `monitor.sh:82-86` (arg validation), `103-111` (mtime compare + echo)
- AC3: `tools/monitor.ps1` same behavior — `monitor.ps1:19-26` (params), `91-98` (mtime compare + Write-Output kick)
- AC4 (optional, exceeded): `--heartbeat <s>` emits `heartbeat` on idle; `--timeout <s>` emits `timeout` and exits — both scripts
- AC5: `docs/help/activity/file.md:37-70` "Bundled watcher scripts" section with usage examples

Note: verifier flagged apparent 30-0893 removal in diff vs dev — rebase divergence artifact. Single commit `ea506a90` is correctly scoped to 3 files only.

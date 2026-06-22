---
title: TMCP — expose SSE endpoint to replace the activity-file monitor (future direction)
source: agent outbox 20260602T025823Z (FRICTION IDEA), 2026-06-02
priority: MEDIUM / near-term — OPERATOR-ENDORSED (msg 65653, 2026-06-02): "consider this for TMCP soon. Maybe a 7.9 release."
status: PLANNED direction — target TMCP v7.9. Operator's shape: "offer a different monitor script that doesn't require a file."
---

## Idea (Agent)
TMCP could expose an **SSE notification endpoint** to replace the current **activity-file monitor**. Benefits:
- Works for BOTH local and remote TMCP deployments (the activity-file monitor is local-filesystem only).
- Eliminates the recurring **Windows file-lock** issues (no file watching).
- Validated by **simple-im's Monitor + curl-SSE** transport (just decided 2026-06-02): agent runs `Monitor(curl -N .../events)`, SSE event wakes it, then fetch.

## Why this is attractive
Directly retires a cluster of recurring frictions:
- TMCP activity_file_monitor relative-path bug ([[feedback_tmcp_monitor_relative_path]] — the misplaced memory file scrubbed in the v7.8.0 release).
- Monitor fragility ([[feedback_monitor_fragility_mindset]]).
- Windows-lock / junction issues (cleanup-worktree.sh fallback; simple-im foreman friction).
One SSE pattern (built for simple-im) generalizes to TMCP's notify leg. Boring, proven (SSE), no file dependency.

## Disposition
- NOT urgent. TMCP just shipped v7.8.0 (PR #196). This is v7.9/v8 territory.
- Sequence AFTER simple-im 15-0006 proves the SSE+Monitor pattern in practice (don't pre-commit TMCP to it until simple-im validates the implementation).
- When triaged: becomes a TMCP task (dev branch, normal CD). Surface to operator as a batched "TMCP next" item, not standalone.

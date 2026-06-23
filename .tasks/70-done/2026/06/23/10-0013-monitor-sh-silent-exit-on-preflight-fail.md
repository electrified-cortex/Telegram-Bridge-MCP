---
id: 10-0013
title: tools/monitor.sh — parent-dir preflight exit emits no stdout token
priority: P3
status: queued
created: 2026-06-23
source: Swarm review OA follow-up (10-0012 post-commit)
---

# monitor.sh: silent EOF on parent-dir preflight failure

## Problem

The parent-dir preflight added in 10-0012 exits with code 1 and emits an error
to stderr, but emits **no stdout token**. Callers that read stdout (e.g. a
harness Monitor armed on monitor.sh output) see a silent EOF with no signal —
they cannot distinguish "monitor failed to start" from "monitor exited cleanly."

## Fix

Before `exit 1`, emit a stdout token so callers can detect the failure:

```bash
echo "monitor.sh: parent directory does not exist: $ACTIVITY_DIR" >&2
echo "error"    # stdout token — callers detect abnormal exit
exit 1
```

Or follow the sse-monitor.sh pattern:
```bash
emit "error"
exit 1
```

## Acceptance Criteria

- [x] Preflight failure emits a token to stdout before exiting
- [x] Token is consistent with the script's output protocol (`error` or similar)
- [x] Existing tests updated; no regressions

## Verification

**Verdict: APPROVED**
Overseer gate: PASS 2026-06-23 — incorporated in release/7.15.0 commit a2a2f30f.
Fix applied via worker/10-0013-0014-monitor-script-fixes, cherry-picked into release/7.15.0.
Build: 0 TS errors. Tests: 3907/3907 pass. SSE tests: 4/4 pass.
Sealed-By: Foreman 2026-06-23

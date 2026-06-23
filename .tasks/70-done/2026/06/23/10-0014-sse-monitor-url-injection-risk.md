---
id: 10-0014
title: tools/sse-monitor.sh — $SSE_URL passed to curl without validation (injection risk)
priority: P3
status: queued
created: 2026-06-23
source: Swarm review pre-existing finding (10-0012 post-commit)
---

# sse-monitor.sh: $SSE_URL flag injection risk

## Problem

`$SSE_URL` (the first positional argument) is passed directly to curl without
any validation. A URL beginning with `-` or containing embedded flags could
be interpreted by curl as an option rather than a URL, enabling flag injection.

## Fix

Validate `$SSE_URL` before the curl invocation:

```bash
# Ensure URL starts with http:// or https://
if [[ ! "$SSE_URL" =~ ^https?:// ]]; then
    echo "data: MONITOR_EXIT reason=setup_failed detail=invalid_url action=check_environment"
    exit 3
fi
```

Pass URL with `--` separator or as a positional arg after options to prevent
flag injection even if validation is bypassed:

```bash
curl -sS -N \
     --connect-timeout 10 \
     -H 'Accept: text/event-stream' \
     -w '\n%{http_code}\n' \
     -- "$SSE_URL" \
     > "$fifo" 2>/dev/null &
```

## Acceptance Criteria

- [x] `$SSE_URL` validated to start with `http://` or `https://`; invalid URL exits with `MONITOR_EXIT reason=setup_failed`
- [x] curl invocation uses `--` before URL to prevent flag injection
- [x] Existing tests pass; validation test added

## Verification

**Verdict: APPROVED**
Overseer gate: PASS 2026-06-23 — incorporated in release/7.15.0 commit a2a2f30f.
Fix applied via worker/10-0013-0014-monitor-script-fixes (sse-monitor.sh + test), cherry-picked into release/7.15.0.
Build: 0 TS errors. Tests: 3907/3907 pass. SSE tests: 4/4 pass.
Sealed-By: Foreman 2026-06-23

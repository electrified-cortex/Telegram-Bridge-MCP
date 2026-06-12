---
Created: 2026-04-11
Status: Draft
Host: local
Priority: 30-473
Source: Copilot review PR #126 (threads 3-4, review cycle 3)
---

# Fix Concurrent Flush Race in LocalLog

## Objective

Fix a race condition in `src/local-log.ts` where `_flushPromise` can be
overwritten while a previous flush is still running, potentially causing
concurrent file writes or lost log entries.

## Context

Copilot review flagged that `_flushTimer` is set to `null` when a flush starts,
allowing a new timer (and thus a new `_flush()`) to begin before the previous
one completes. The `_flushPromise` variable gets overwritten, losing the
reference to the in-flight flush.

**PR #126 thread IDs:** PRRT_kwDORVJb9c56SJee, PRRT_kwDORVJb9c56SJej

## Acceptance Criteria

- [x] `_flush()` serializes correctly — no concurrent writes to the same file
- [x] `_flushPromise` chains rather than overwrites
- [x] Existing tests pass
- [x] New test verifying concurrent flush calls don't interleave

## Completion

**Branch:** `30-473-locallog-flush-race` (off `dev`)
**Commit:** `c448a5b` — `fix(local-log): serialize concurrent flushes via promise chaining`

### What was done

- `src/local-log.ts`: extracted `_actualFlush()` from `_flush()`; all flush paths chain via `_flushPromise = _flushPromise.then(_actualFlush)` instead of overwriting; `_flushTimer = null` moved to timer callback
- `src/local-log.test.ts`: new concurrent test — 3 concurrent `flushCurrentLog()` calls + 2 more events mid-flight; verifies all 5 entries appear in order with no duplicates
- All 2368 tests pass, lint clean

**Awaiting Overseer push + PR creation.**

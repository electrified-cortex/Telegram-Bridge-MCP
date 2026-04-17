---
Created: 2026-04-08
Status: Draft — converted to verification task
Host: local
Priority: 10
Source: Codex swarm review finding 5 + operator design feedback
---

# Async Buffered Logging for Local Log System

## ⚠️ Triage Note (2026-04-14)

May already be implemented — verify before starting. If appendFileSync is already replaced, close as stale.

## Problem

`local-log.ts` uses `appendFileSync()` for every log event — synchronous I/O
that blocks the event loop. While negligible on NVMe, it's architecturally
unclean and prevents batching.

## Solution

Replace sync writes with a debounced in-memory queue:

1. `logEvent()` enqueues to an in-memory buffer (instant return)
2. Each enqueue resets a ~500ms `setTimeout` timer
3. When timer fires, batch-flush all buffered events in one `appendFile()` call
4. On process exit/shutdown, flush synchronously (drain guarantee)

## Design Notes

- JavaScript is single-threaded — queue + setTimeout is sufficient
- Use existing queue primitives if available
- Risk of losing buffered events on crash is acceptable (operator confirmed)
- Retain the same log format and file structure
- No external dependencies needed

## Verification

- [ ] All existing log tests pass
- [ ] New test: multiple rapid log events produce single batched write
- [ ] New test: shutdown flushes remaining buffer
- [ ] Build, lint, test green

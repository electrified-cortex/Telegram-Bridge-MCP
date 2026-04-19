---
Created: 2026-04-08
Status: Rejected (pre-flight)
Host: local
Priority: 10-395
Source: PR #126 Copilot review (Round 1+2)
---

## ⚠️ Pre-Flight Rejection

All three acceptance criteria are already satisfied in the current `dev` HEAD (`3f527e9`):

1. `listLogs()` in `src/local-log.ts:168` already filters with `TIMESTAMP_FILENAME_RE`
2. `roll_log` description already reads "any caller with a valid authenticated token can trigger a roll" — no "No session ID required" verbiage
3. `toggle_logging` description already reads "Events are written synchronously" with no false buffer claim

No code changes needed. Task superseded by prior work.

# Log tool description fixes: roll_log, toggle_logging, listLogs filter

## Objective

Fix misleading tool descriptions and a filter inconsistency in the logging tools.

## Context

PR #126 Copilot comments:
- [r3048353396](https://github.com/electricessence/Telegram-Bridge-MCP/pull/126#discussion_r3048353396) — listLogs filter
- [r3048353413](https://github.com/electricessence/Telegram-Bridge-MCP/pull/126#discussion_r3048353413) — roll_log description
- [r3048353431](https://github.com/electricessence/Telegram-Bridge-MCP/pull/126#discussion_r3048353431) — toggle_logging description

## Issues

1. **listLogs filter mismatch:** `listLogs()` returns any `*.json` in data/logs/
   but `getLog()`/`deleteLog()` reject non-timestamp filenames via
   `sanitizeFilename()`. Filter with `TIMESTAMP_FILENAME_RE`.

2. **roll_log description:** Says "No session ID required" but handler requires
   `token` and calls `requireAuth()`. Fix wording to clarify it doesn't require
   a separate session selection, just a valid token.

3. **toggle_logging description:** Says "current log buffer" is flushed on disable
   but writes are synchronous per event (no buffer). Update description.

## Acceptance Criteria

- [ ] `listLogs()` filters results with TIMESTAMP_FILENAME_RE
- [ ] `roll_log` description clarified re: authentication
- [ ] `toggle_logging` description accurately describes sync behavior
- [ ] Build and tests pass

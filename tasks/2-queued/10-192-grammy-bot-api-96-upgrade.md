---
Created: 2026-04-03
Status: Queued
Priority: 10
Source: Operator directive (voice)
Epic: Bot API 9.6
Repo: electricessence/Telegram-Bridge-MCP
Branch target: dev
Gate: Sentinel review required before execution
---

# 10-192: Upgrade grammY to Bot API 9.6

## Epic Context

This is the foundation task for the **Bot API 9.6 epic**. All other 9.6 feature
tasks depend on this. See the full analysis at
`cortex.lan/docs/research/2026-04-03-bot-api-96-analysis.md`.

Related tasks: 15-193, 20-194, 15-195

## Goal

Bump grammY from ^1.41.1 (Bot API 9.5) to the version supporting Bot API 9.6
(expected ~1.42.0). Verify type availability for new API methods.

## Context

grammY has shipped same-day support for the last three Bot API releases:
- 9.3 → v1.39.0 (Dec 31, 2025)
- 9.4 → v1.40.0 (Feb 9, 2026)
- 9.5 → v1.41.0 (Mar 1, 2026)

Bot API 9.6 was released April 3, 2026. The grammY update is expected within
0-7 days. Until typed support lands, raw API calls are available via
`bot.api.raw.*`.

## Approach

1. Monitor grammY releases for 9.6 support.
2. Bump `grammy` in `package.json` to the new version.
3. Run `npm install` and verify clean build (`npm run build`).
4. Run full test suite (`npm test`).
5. Verify new types are available: `ManagedBotCreated`, `ManagedBotUpdated`,
   `KeyboardButtonRequestManagedBot`, `PollOptionAdded`, `PollOptionDeleted`.
6. Verify new API methods are typed: `getManagedBotToken`,
   `replaceManagedBotToken`, `savePreparedKeyboardButton`.

## Acceptance Criteria

- [ ] grammY version updated to one supporting Bot API 9.6
- [ ] Clean build with no type errors
- [ ] All existing tests pass
- [ ] New 9.6 types importable and documented in commit message

## Blocker

**Blocked until grammY publishes 9.6 support.** Check
https://github.com/grammyjs/grammY/releases periodically.

## Reversal Plan

Revert `package.json` and `package-lock.json` to previous versions. Run
`npm install`.

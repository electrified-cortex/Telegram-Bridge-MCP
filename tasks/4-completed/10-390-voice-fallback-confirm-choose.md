---
Created: 2026-04-08
Status: Queued
Host: local
Priority: 10-390
Source: PR #126 Copilot review (Round 2+3)
---

## ⚠️ Pre-Flight Rejection

**All acceptance criteria already met in current `dev` HEAD (`3f527e9`).**

- `confirm.ts` line 130: `const resolvedVoice = getSessionVoice() || getDefaultVoice()` — ✅ fallback implemented
- `choose.ts` line 164: `const resolvedVoice = getSessionVoice() || getDefaultVoice()` — ✅ fallback implemented
- Both files' `audio` parameter descriptions already say "Uses session/global voice settings" — ✅ description accurate

This fix was already delivered (likely alongside 10-389's MarkdownV2 caption fix in the same upstream commit). Task is moot.

---

# Voice parameter fallback to session default in confirm + choose

## Objective

Implement session/global voice default fallback in `confirm.ts` and `choose.ts`
voice mode, matching the behavior of the unified `send` tool.

## Context

PR #126 Copilot comments:
- [r3049211335](https://github.com/electricessence/Telegram-Bridge-MCP/pull/126#discussion_r3049211335) (confirm)
- [r3049211404](https://github.com/electricessence/Telegram-Bridge-MCP/pull/126#discussion_r3049211404) (choose)
- [r3049408370](https://github.com/electricessence/Telegram-Bridge-MCP/pull/126#discussion_r3049408370) (choose, Round 3)
- [r3049408387](https://github.com/electricessence/Telegram-Bridge-MCP/pull/126#discussion_r3049408387) (choose, Round 3)
- [r3049408402](https://github.com/electricessence/Telegram-Bridge-MCP/pull/126#discussion_r3049408402) (confirm, Round 3)
- [r3049408413](https://github.com/electricessence/Telegram-Bridge-MCP/pull/126#discussion_r3049408413) (confirm, Round 3)

Currently `resolvedVoice = voice` with no fallback to `getSessionVoice()` /
`getDefaultVoice()`. The description says "session default if omitted" but
this is not implemented.

## Acceptance Criteria

- [ ] `confirm.ts`: voice parameter falls back to session/global default when omitted
- [ ] `choose.ts`: voice parameter falls back to session/global default when omitted
- [ ] Parameter descriptions updated to match actual behavior
- [ ] Consistent with `send` tool's voice fallback pattern
- [ ] Build and tests pass

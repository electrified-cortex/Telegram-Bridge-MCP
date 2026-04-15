## ⚠️ Pre-Flight Rejection

**Criterion already satisfied in `3f527e9` (dev HEAD).**

The description in `src/tools/answer_callback_query.ts` already reads:
> "For non-blocking keyboards, use send_choice."

The `choose` reference was already removed before this task was created. No work needed.

---


Source: PR #126 Copilot review (Round 4)
---

# answer_callback_query: misleading non-blocking reference

## Objective

Fix the tool description for `answer_callback_query` which incorrectly says
"For non-blocking keyboards, use choose or send_choice" — `choose` is blocking.

## Context

PR #126 Copilot comment:
- [r3049232911](https://github.com/electricessence/Telegram-Bridge-MCP/pull/126#discussion_r3049232911)

Should only reference `send_choice` as the non-blocking alternative.

## Acceptance Criteria

- [ ] Description references only `send_choice` for non-blocking keyboards
- [ ] Build passes

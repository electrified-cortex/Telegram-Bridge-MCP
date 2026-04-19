## ⚠️ Pre-Flight Rejection

**Reason:** Already delivered. Both `confirm.ts` and `choose.ts` already apply `markdownToV2()` with `parse_mode: "MarkdownV2"` for voice captions — present in `origin/dev` (pre-dates this task). All acceptance criteria are met by existing code.

**Checked:** `git show origin/dev:src/tools/confirm.ts` and `choose.ts` both have `markdownToV2(rawCaption)` + `parse_mode: "MarkdownV2"` at the voice caption send site.

---

# Voice caption MarkdownV2 not applied in confirm + choose

## Objective

Apply `markdownToV2()` conversion and set `parse_mode: "MarkdownV2"` for voice
captions in `confirm.ts` and `choose.ts`. Currently the voice path sends topic-
formatted captions with raw `**` markup that renders as literal text.

## Context

PR #126 Copilot comments:
- [r3049211330](https://github.com/electricessence/Telegram-Bridge-MCP/pull/126#discussion_r3049211330) (confirm)
- [r3049211343](https://github.com/electricessence/Telegram-Bridge-MCP/pull/126#discussion_r3049211343) (choose)
- [r3049232871](https://github.com/electricessence/Telegram-Bridge-MCP/pull/126#discussion_r3049232871) (choose, Round 3)

The text path correctly converts to MarkdownV2 but the voice path skips it.

## Acceptance Criteria

- [ ] `confirm.ts` voice caption goes through `markdownToV2()` with `parse_mode: "MarkdownV2"`
- [ ] `choose.ts` voice caption goes through `markdownToV2()` with `parse_mode: "MarkdownV2"`
- [ ] Topic formatting (`**[topic]**`) renders correctly in voice captions
- [ ] Build and tests pass

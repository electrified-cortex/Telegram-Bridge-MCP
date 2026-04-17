---
Created: 2026-04-03
Status: Draft
Host: local
Priority: 05-204
Source: Operator
---

# 05-204 — Expired Callback Button Cleanup

## Objective

When interactive buttons (confirm, choose, ask, etc.) expire without a response, the buttons should be removed from the message and replaced with a "> options timed out" indicator. Currently, expired buttons remain visible as dead UI — tapping them produces a Telegram "query is too old" error.

## Context

Telegram's `answerCallbackQuery` fails after a callback button goes stale (~30–60 s depending on client). The bridge already has timeout logic for approval dialogs (`APPROVAL_TIMEOUT_MS`) that edits the message on denial/timeout. However, other interactive tools (`confirm`, `choose`, `ask`) may not consistently clean up their buttons on expiration.

This applies primarily to buttons attached to voice message acknowledgments and interactive prompts. Text-based callback buttons may not hit this as often, but all interactive buttons should follow the same cleanup pattern.

## Acceptance Criteria

- [ ] All tools that create inline keyboard buttons register a timeout cleanup
- [ ] On timeout: buttons are removed from the message via `editMessageReplyMarkup`
- [ ] On timeout: message text is appended or edited to indicate "> options timed out"
- [ ] Existing approval dialog cleanup (session_start) is not regressed
- [ ] Tests cover the timeout cleanup path for at least `confirm` and `choose`

## Completion

- **Branch:** `05-204-expired-callback-button-cleanup` (worktree: `Telegram MCP/.worktrees/05-204-expired-callback-button-cleanup`)
- **Commit:** `1f19ba9` — fix(confirm,choose): immediately remove expired buttons on timeout
- **Files:** `src/tools/confirm.ts`, `src/tools/choose.ts`, `src/tools/confirm.test.ts`, `src/tools/choose.test.ts`
- **Notes:** On timeout/abort, immediately calls `editWithTimedOut()` to remove buttons and show timed-out indicator. Replaces full callback hook with ack-only version so late button presses get spinner dismissed without re-editing. Tests: 2347/2347 pass.

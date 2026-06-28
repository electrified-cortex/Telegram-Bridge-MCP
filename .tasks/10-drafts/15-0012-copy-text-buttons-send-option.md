---
title: "Add copy_text buttons as a send option (Bot API 7.11)"
created: 2026-06-26
status: draft
priority: 15
type: Feature
source: Operator directive — Telegram feature audit triage (2026-06-26)
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
epic: Bot API feature coverage
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
related:
  - .tasks/10-drafts/15-0011-link-preview-options.md
---

# 15-0012 — copy_text buttons as a `send` option

## Problem

When the agent gives the operator something meant to be *used* — a shell
command, a file path, a token, a URL, a config snippet — the operator has to
manually select-and-copy it from the message body on mobile, which is fiddly and
error-prone.

Telegram's **`copy_text` inline button** (Bot API 7.11) solves this exactly: a
button that copies a fixed string to the clipboard on tap, with a "Copied" toast.
Neither of the bridge's existing mechanisms can do this:

- Inline **callback** buttons (`choice`/`choose`) send a `callback_query` back to
  the bot — they don't touch the clipboard.
- **Slash commands** are operator→agent, not a copy affordance.

This is a genuinely new capability and a strong fit for an agent→operator bridge.

## Goal

Let the agent attach one or more copy-to-clipboard buttons to a `send` text
message. Operator-requested shape: this is a **`send` option**, not a new
standalone tool.

## Proposed parameter

On the `send` tool (`src/tools/send.ts`), text path. Support a shorthand and a
full form:

```
// shorthand: single "📋 Copy" button copying the given string
copy: z.string().optional()

// full form: one or more labeled copy buttons
copy_buttons: z.array(z.object({
  label: z.string(),       // button text, ≤ 64 chars
  text: z.string(),        // string copied to clipboard, ≤ 256 chars
})).optional()
```

Rendered as an inline keyboard of `copy_text` buttons:
`{ text: label, copy_text: { text } }`. The shorthand `copy: "npm run build"`
produces a single `📋 Copy` button copying that string.

## Integration points

The plain text send path currently attaches **no** `reply_markup` (only
`choice`/`choose` build keyboards). This task adds `reply_markup` support to the
plain text send:

- `src/tools/button-helpers.ts` — add `buildCopyTextButtons(buttons)` returning
  `{ text, copy_text: { text } }[]` rows (mirrors `buildKeyboardRows`), with
  length validation (label ≤ `LIMITS.BUTTON_TEXT` = 64; copy text ≤ 256 — add a
  `LIMITS.COPY_TEXT = 256` constant in `telegram.ts`).
- `src/tools/send.ts` — schema additions above; in the text-only path, when
  `copy`/`copy_buttons` is present, build the keyboard and pass
  `reply_markup: { inline_keyboard: rows }` to the `getApi().sendMessage(...)`
  call (~line 573).
- Add a `COPY_TEXT_TOO_LONG` / reuse `BUTTON_LABEL_TOO_LONG` error code in
  `telegram.ts` `TelegramErrorCode` for pre-validation failures.

## Edge cases / constraints

- **Rich-message path** (`routeOutboundMessage`, Bot API 10.1): rich messages
  don't take an inline keyboard the same way. When `copy*` is set, force the
  plain send path (skip rich routing) — same fallback pattern the task should
  document, not silently drop the buttons.
- **Multi-chunk messages**: when `splitMessage` produces multiple chunks, attach
  the copy keyboard to the **last** chunk only (buttons belong at the end).
- **Coexistence**: copy_text buttons can share an inline keyboard with url and
  callback buttons, so this does not conflict with a future "url button" option.
- `copy_text.text` hard limit is 256 chars (Telegram) — validate before send and
  return a structured error, don't let the API 400.

## Acceptance criteria

- [ ] `send(text: "...", copy: "npm run build")` renders a `📋 Copy` button that
      copies the string on tap.
- [ ] `send(text: "...", copy_buttons: [{label, text}, ...])` renders one labeled
      copy button per entry.
- [ ] copy text > 256 chars or label > 64 chars returns a structured error
      (no raw Telegram 400).
- [ ] When `copy*` is set with rich messages enabled, the plain path is used.
- [ ] Multi-chunk: copy keyboard attaches to the final chunk only.
- [ ] Unit test for `buildCopyTextButtons` + validation.
- [ ] `pnpm build` clean; `pnpm test` passes.
- [ ] PR staged against `dev`. Do NOT merge.

## Scope boundary

- `send` text path only. No copy buttons on `send_file` captions, polls, or
  interactive question types in this task.
- No url-button or login-button option (separate future work).

## Notes

- grammY 1.43 `InlineKeyboardButton` type includes `copy_text` (Bot API 7.11).
- Pairs naturally with link-preview control
  ([15-0011](15-0011-link-preview-options.md)) as Bot-API-coverage quick wins.

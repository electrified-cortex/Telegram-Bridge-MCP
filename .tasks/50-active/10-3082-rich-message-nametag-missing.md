---
id: 10-3082
title: "TMCP: Session nametag not visible on rich/file messages"
priority: P2
status: draft
category: Bug/UX
filed: 2026-06-28
source: TG 80086
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: worker/tmcp-p4-nametag-rich-messages
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# 10-3082: Nametag Missing on Rich/File Messages

## Problem

The session nametag prefix (e.g. `🟦 👨‍🏫 Curator`) is not visible when a bot session
sends a rich message — tables, heavy Markdown formatting, or file/document sends. For
standard text messages the nametag appears as the first line of the message. For rich
messages it is lost.

Operator confirmed (TG 80086): "because you sent a rich message, I don't see your nametag."

Without a visible nametag the operator cannot identify which agent sent a message,
breaking multi-agent clarity in the chat.

## Known failure modes

1. **File/document sends** (`type: "file"`): nametag is placed in caption but Telegram
   visually de-emphasizes captions on file messages; the icon/preview dominates.
2. **Very long messages** (>4096 chars, split across chunks): nametag is in the first chunk
   but subsequent chunks arrive without it.
3. **Markdown table messages**: Telegram may strip or reformat the opening nametag line
   when the message contains complex table syntax.

## Scope

Investigation-first task. Worker must:

1. Identify which send path(s) produce the missing-nametag symptom (file, split, table).
2. For each confirmed path, apply the minimal fix:
   - **File sends**: ensure nametag is also set as caption prefix AND prepend a brief
     nametag-only message immediately before the file if caption is still invisible.
   - **Split messages**: ensure ALL chunks carry the nametag, not just chunk 1.
   - **Table/rich text**: if Telegram strips the first line, send the nametag as a
     separate preceding message (`_skipHeader: false`, reply-to nothing).
3. Record investigation findings in the task file as a note for reviewer.

## Acceptance Criteria

- [ ] Investigation note filed in task file: exact failure modes identified (which send
      types drop the nametag and why)
- [ ] File/document sends show the session nametag prefix in a visible position
      (caption or a preceding message) so the operator can identify the sender
- [ ] All split-message chunks carry the nametag, not only the first chunk
- [ ] No regression: standard text message nametag behavior unchanged
- [ ] Worker smoke test: send `type: "file"` with a small txt file; confirm nametag visible
      in Telegram chat before the file message
- [ ] `npm run build` passes; existing tests pass

## Worker notes

- Nametag injection path: likely `src/session-header.ts` or wherever the session
  name prefix is prepended. Find where it's applied to each send type.
- The `_skipHeader` flag on Telegram API calls controls whether the header fires —
  trace its usage to understand which paths suppress it.
- File send: look at `src/tools/send.ts` case for `file` type + `src/tools/download/`
- Long-message split: look for the chunking path in `src/telegram.ts` or `src/tools/send.ts`

## Worktree

Branch: `worker/tmcp-p4-nametag-rich-messages`
Directory: `.git/.wt/tmcp-p4-nametag-rich-messages`
Base: `dev` at current HEAD

## Gate review

- reviewer: gate
- date: 2026-06-28
- verdict: PASS
- review type: adversarial gate
- checked: ACs 1-4 binary+testable (investigation note as AC1 is a deliverable, not process — accepted); AC5 smoke test is validation-only; scope bounded to nametag injection path + confirmed send types; three known failure modes documented (good for worker); delegation correct (Worker, sonnet-class, medium)
- fixed: corrected body heading 10-3079→10-3082; base branch main→dev
<!-- overseer-gate: PASS 2026-06-28 -->

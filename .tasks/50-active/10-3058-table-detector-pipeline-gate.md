---
id: "10-3058"
title: "Story: table detector gate — extract unrenderable markdown tables as attachments (epic 10-3050 pipeline)"
type: story
created: 2026-06-29
status: draft
priority: 15
epic: 10-3050
depends_on:
  - 10-3051   # shared detect→placeholder→attach pipeline + SAFE_FILE_DIR
  - 10-3055   # ordering fix + formatting-preservation + context-aware placeholder wording
supersedes:
  - .tasks/20-backlog/tmcp-backlog-table-rendering.md   # Cases A and B absorbed here
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# 10-3058 — Table detector gate (epic 10-3050 pipeline extension)

Part of epic [10-3050](../epics/10-3050-visual-content-attachments-epic.md).

Adds a **table detector gate** to the pre-send pipeline established by 10-3051.
The gate runs in the same detection chain as the SVG and mermaid gates — a markdown
table that cannot render inline is extracted to a file attachment and replaced with
a placeholder, following the same ordering and placeholder-wording rules introduced
by 10-3055.

This story **supersedes and absorbs** the backlog item in
`.tasks/20-backlog/tmcp-backlog-table-rendering.md` (Cases A and B). The
attachment-extraction approach resolves the majority of oversized-table cases
without the complex sequencing/splitting logic the backlog item contemplated.

## Problem

Telegram enforces a 4096-character per-message limit. A markdown table that exceeds
the limit (alone or in combination with surrounding content) cannot be delivered
inline in any send mode. The current behavior (`TABLE_NOT_RENDERED` / fail-loud) is
correct as a guard but suboptimal as a resolution — it forces the caller to
reformulate rather than delivering the table through a fallback path.

A secondary case: even when a table fits within 4096 characters, it may be embedded
in a message that uses markdown formatting which precludes same-message inline
rendering. In that case the same extract-and-attach pattern applies.

## Scope

A new **table detector gate** is inserted into the existing pre-send pipeline
(10-3051) as a chained step alongside the SVG and mermaid gates. The gate:

1. **Detects** a GFM markdown table in the outbound message content.
2. **Evaluates** whether the table is unrenderable inline (see criteria below).
3. If unrenderable: **extracts** the table into a `.md` file attachment (containing
   only the table, as valid GFM markdown) and **replaces** the table block in the
   prose with a context-dependent placeholder (same wording rules as 10-3055).
4. **Delivers** the prose first, attachment after — following the ordering and
   delivery-mode rules from 10-3055.
5. **Residual guard:** if, after extracting the table, the remaining prose _still_
   exceeds the 4096-character limit, the extraction does not proceed — the message
   remains fail-loud for that case. The gate exits without modification.

## Unrenderable conditions (trigger extraction)

The table gate triggers extraction when **any** of the following apply to the
outbound message:

- The table content alone exceeds a size that would cause Telegram to truncate or
  reject the message.
- The table is part of a message whose total character count exceeds 4096 characters,
  and removing the table from the inline content brings the remaining prose within
  the limit.
- The send path carries a constraint that prevents inline table rendering (e.g.
  an in-flight audio sequence or effect flag that blocks the rich-text render path)
  — equivalent to the Case A and Case B conditions in the superseded backlog item.

The table gate does **not** trigger when the table can render inline without any of
the above conditions applying (no false positives).

## File attachment format

The extracted file is a `.md` (markdown) file containing the table block exactly as
it appeared in the original message — no reformatting, no added headers, no added
commentary. The file name is descriptive (e.g. `table.md`). Reuse `SAFE_FILE_DIR`
and `handleSendFile` from 10-3051; no new transport or file-writing infrastructure.

## Placeholder wording

Follows the 10-3055 rules exactly:
- Same-message delivery: **"see attachments"** (or equivalent same-message reference).
- Follow-up delivery: **"see following attachments"** or **"see following message"**
  (or equivalent forward reference).

The implementation inherits the context-dependent wording logic from 10-3055; it
does not re-implement it.

## What this story does NOT do

- Does not introduce new transport, file-writing, or typing-indicator infrastructure
  (all inherited from 10-3051).
- Does not implement the Case A sequencing/audio-queuing logic from the backlog
  (the attachment path resolves the table delivery; audio-queuing complexity is
  no longer needed for this case).
- Does not implement multi-table splitting (one table per extraction; multiple
  tables in one message are each extracted independently as separate attachments).
- Does not render the table to a non-markdown format (the attachment is the GFM
  source, not a rendered image or PDF).
- Does not modify the fail-loud guard for the residual case (remaining prose still
  too large after extraction stays fail-loud — behavior unchanged).

## Acceptance criteria

- [ ] **Gate trigger — oversized table:** a message containing a markdown table
      whose presence causes the total character count to exceed 4096 characters
      triggers extraction; a test fixture confirms the attachment is delivered and
      the prose (with placeholder) arrives first.
- [ ] **Gate trigger — constrained send path:** a message whose send path cannot
      render a table inline (blocked render mode) triggers extraction; a test
      fixture covering at least one such constraint confirms extraction fires.
- [ ] **No false positive — renderable table:** a message containing a markdown
      table that fits within the 4096-char limit on an unconstrained send path is
      delivered as-is; no extraction occurs.
- [ ] **Residual guard — rest still oversized:** when extracting the table would
      leave remaining prose that still exceeds 4096 characters, extraction does not
      proceed; the message remains fail-loud (TABLE_NOT_RENDERED or equivalent);
      a test fixture confirms this.
- [ ] **Attachment content:** the `.md` attachment contains the table block verbatim
      (no reformatting or added content); confirmed by reading the attachment.
- [ ] **Formatting preservation:** the prose delivered is character-for-character
      identical to the input outside the replaced table span (inherits the 10-3055
      rule); confirmed by a test fixture with surrounding markdown.
- [ ] **Ordering — prose first:** the prose message arrives before the attachment in
      all delivery modes; the attachment never precedes the prose.
- [ ] **Placeholder wording matches delivery mode:** same-message placeholder does
      not use a forward reference; follow-up placeholder uses a forward reference;
      confirmed for each delivery mode.
- [ ] **Multi-table:** a message with two or more markdown tables extracts each
      independently as separate `.md` attachments; the prose retains a placeholder
      for each.
- [ ] **Pipeline position:** the table gate is a chained step in the same pre-send
      pipeline as the SVG and mermaid gates (10-3051) — not a post-send bolt-on;
      confirmed by code review.
- [ ] **Reuse:** `SAFE_FILE_DIR`, `handleSendFile`, and the 10-3055 placeholder-
      wording logic are reused, not duplicated.
- [ ] **Regression — 10-3051 and 10-3055 ACs unaffected:** all prior acceptance
      criteria from 10-3051 and 10-3055 continue to pass.
- [ ] `pnpm build` clean; `pnpm test` passes. PR staged, not merged.

## Notes

- The mermaid gate (10-3051) is the reference implementation for the detect →
  placeholder → attach pattern. The table gate follows the same structure.
- The backlog item `.tasks/20-backlog/tmcp-backlog-table-rendering.md` noted that
  this pattern is gated on mermaid refinement. 10-3055 provides that refinement;
  this story may proceed once 10-3051 and 10-3055 are both merged.

## Gate review

- date: 2026-06-29
- verdict: GATED PASS — Overseer
- notes: 13 binary ACs, all testable. Scope bounded with explicit "does NOT do" list. Supersedes backlog table-rendering item (Cases A+B absorbed). Depends on 10-3051 (shipped) + 10-3055 (queued — sequence enforced). Residual fail-loud guard preserved for rest-still-oversized case. Pipeline position AC prevents bolt-on anti-pattern.
- The operator-proposed approach ("magical fix") in the backlog item maps directly
  to this story's design; no conceptual change, only formalization as an epic story.

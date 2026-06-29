---
id: "10-3055"
title: "Story: fix attachment ordering, formatting preservation, and context-dependent placeholder wording in 10-3051's pipeline"
type: story
created: 2026-06-29
status: draft
priority: 15
epic: 10-3050
depends_on:
  - 10-3051   # the shipped pipeline being corrected
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# 10-3055 — Pipeline ordering fix + formatting preservation + context-aware placeholder wording

Refinement story against the shipped 10-3051 pipeline
(epic [10-3050](../epics/10-3050-visual-content-attachments-epic.md)).

Three behavioral defects observed in 10-3051's implementation are corrected here.
No new detection or rendering logic is introduced — this story amends the _delivery_
behavior of the existing pipeline.

## Defects being fixed

### D-1 — Wrong message order (attachment before prose)

The shipped pipeline calls `sendDocument` first and then delivers the prose message.
A Telegram attachment sent above a long message can scroll off the screen — the
recipient may never see it, making the delivery look broken.

**Required order:** prose is delivered first; attachment(s) follow. The prose must
arrive at or before the attachment in every delivery mode. The attachment must
**never** precede the prose.

### D-2 — Formatting change outside the placeholder substitution

The shipped pipeline altered formatting in the prose beyond replacing the detected
block. The prose that is sent must be character-for-character identical to the
original except at the exact span occupied by the detected block, which is replaced
by the placeholder string. No surrounding whitespace, punctuation, line breaks,
markdown markup, or other characters may be added, removed, or reordered as a
side-effect of the substitution.

### D-3 — Fixed placeholder wording regardless of delivery mode

The shipped pipeline used a static placeholder regardless of whether the attachment
was in the same message or a follow-up message. The wording must reflect how the
attachment actually arrives:

- **Same-message delivery** (attachment and prose in one Telegram message):
  placeholder text must say **"see attachments"** (or an equivalent same-message
  reference).
- **Follow-up delivery** (attachment arrives in a separate subsequent message):
  placeholder text must say **"see following attachments"** or **"see following
  message"** (or an equivalent forward-reference).

## Delivery modes (normative)

**Ideal (gold):** the attachment and the prose are in the same Telegram message,
with full formatting retained. The placeholder uses the same-message wording.

**Acceptable fallback:** the prose is sent first with the placeholder substituted
(follow-up wording). The attachment(s) are then sent in an immediately following
message. This fallback is required in any case where same-message delivery is not
achievable without altering the prose formatting (e.g. markdown-formatted prose
with an attachment — if Telegram cannot carry both simultaneously).

**Never acceptable:** attachment before prose in any delivery mode.

The implementation must determine which mode is possible before sending and select
the appropriate placeholder wording accordingly. Once the wording is embedded in
the prose, the delivery must match it.

## Scope

- Amend `sendDocument` / prose dispatch ordering in the pipeline established by
  10-3051 so that prose is dispatched first in every flow.
- Amend the substitution step so that no characters outside the detected block's
  span are modified.
- Introduce context-dependent placeholder wording: the wording is chosen once the
  delivery mode is determined and before the prose is sent.
- No changes to detection logic, file-writing logic, or the SVG/mermaid extraction
  rules — those are owned by 10-3051 / 10-3053.
- No changes to the `upload_document` typing-indicator behavior (unchanged from
  10-3051).

## Acceptance criteria

- [ ] **Ordering — prose first:** sending a message containing a detected block
      (SVG or mermaid) results in the prose message arriving in Telegram before (or
      simultaneous with) the attachment — confirmed by observing message timestamps
      and order in the chat. The attachment does not appear above the prose.
- [ ] **Ordering — follow-up arrives immediately after:** when same-message delivery
      is not used, the attachment follow-up message appears directly after the prose
      message with no intervening unrelated messages.
- [ ] **Formatting preservation — no side-effect changes:** the delivered prose is
      character-for-character identical to the input outside the replaced block span.
      A test fixture with surrounding markdown (bold, italic, code spans, blockquotes,
      newlines) confirms zero collateral changes.
- [ ] **Formatting preservation — multi-block:** when multiple visual blocks are
      present, each substitution is independent; no substitution disturbs characters
      outside its own span.
- [ ] **Placeholder wording — same-message:** when the attachment is in the same
      Telegram message as the prose, the placeholder contains "see attachments" (or
      equivalent same-message reference, not a forward reference).
- [ ] **Placeholder wording — follow-up:** when the attachment is sent as a
      separate follow-up message, the placeholder contains "see following attachments"
      or "see following message" (or equivalent forward reference, not a same-message
      reference).
- [ ] **Placeholder wording — accuracy:** the wording chosen matches the delivery
      mode that actually executes — not a guess or a default. (Test: force each mode
      and assert the placeholder string.)
- [ ] **Regression — 10-3051 ACs unaffected:** all seven acceptance criteria from
      story 10-3051 continue to pass with these changes applied.
- [ ] `pnpm build` clean; `pnpm test` passes. PR staged, not merged.

## Notes

- The same ordering, formatting-preservation, and placeholder-wording rules defined
  here are the canonical rules for the entire epic 10-3050 pipeline. Story 10-3058
  (table detector) and any future detector gates must follow the same rules by
  reference to this story, not by reimplementing them.
- Same-message feasibility (whether Telegram can carry a file attachment and retain
  MarkdownV2 formatting simultaneously) is an open question flagged in
  `.tasks/00-ideas/mermaid-refinement-2026-06-29.md`. The implementation should
  attempt same-message delivery first and fall back gracefully; the answer may
  differ per formatting mode (plain text vs MarkdownV2 vs HTML).

## Gate review

- date: 2026-06-29
- verdict: GATED PASS — Overseer
- notes: 9 binary ACs, all testable. Scope bounded (amends delivery behavior only — no detection, file-writing, or SVG/mermaid changes). Depends on 10-3051 (shipped). Open same-message feasibility question handled by implementation fallback — not a blocking open question. Canonical placeholder/ordering rules for epic 10-3050 established here.

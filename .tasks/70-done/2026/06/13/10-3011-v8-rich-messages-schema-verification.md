---
created: 2026-06-13
status: draft
priority: 10
source: Curator decomposition of epic 10-3001 (operator voice, 2026-06-11)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
epic: 10-3001-v8-rich-messages-markup
depends_on: ["10-3010"]
---

# 10-3011 — Rich Messages: Bot API 10.1 Schema Verification + Type Definitions

## Context

Epic 10-3001 §7 identifies schema verification as **BLOCKING for Phase 1**.
The epic was filed on 2026-06-11, the same day Bot API 10.1 was released.
All field names in the epic are marked as inferred and must not be treated as
normative. This task produces the verified schema snapshot and the TypeScript
type file that all subsequent implementation tasks will import.

Telegram Bot API 10.1 (released 2026-06-11) introduced `sendRichMessage`,
`sendRichMessageDraft`, and a hierarchy of `RichBlock` subtypes. The confirmed
type names from `core.telegram.org/bots/api` (fetched 2026-06-13) are:

- **Methods:** `sendRichMessage`, `sendRichMessageDraft`
- **Core types:** `RichMessage`, `RichBlock`, `RichText`, `InputRichMessage`,
  `InputRichMessageContent`
- **RichText inline:** `RichTextBold`, `RichTextItalic`, `RichTextUnderline`,
  `RichTextStrikethrough`, `RichTextSpoiler`, `RichTextSubscript`,
  `RichTextSuperscript`, `RichTextCode`, `RichTextMarked`,
  `RichTextMathematicalExpression`, `RichTextAnchor`, `RichTextAnchorLink`,
  `RichTextReference`, `RichTextReferenceLink`
- **RichBlock structural:** `RichBlockParagraph`, `RichBlockSectionHeading`,
  `RichBlockPreformatted`, `RichBlockBlockQuotation`, `RichBlockPullQuotation`,
  `RichBlockList`, `RichBlockListItem`, `RichBlockTable`, `RichBlockTableCell`,
  `RichBlockDetails`, `RichBlockDivider`, `RichBlockFooter`, `RichBlockAnchor`,
  `RichBlockCaption`, `RichBlockMathematicalExpression`
- **RichBlock media:** `RichBlockCollage`, `RichBlockSlideshow`,
  `RichBlockAnimation`, `RichBlockAudio`, `RichBlockPhoto`, `RichBlockVideo`,
  `RichBlockVoiceNote`, `RichBlockMap`, `RichBlockThinking`

**Field-level details (required/optional, nesting limits, size limits) were not
fully returned by the initial doc fetch and must be verified in this task.**

## Objective

1. Fetch and verify the full parameter-level schema for `sendRichMessage`,
   `InputRichMessage`, and all `RichBlock` subtypes from the live Bot API docs.
2. Produce `docs/rich-message-schema.md` — a snapshot of confirmed field names,
   types, required/optional status, and any size or nesting limits.
3. Produce `src/types/rich-message.ts` — minimal TypeScript interfaces covering
   the subtypes needed for Phases 1–3 of the epic (headings, paragraphs, code,
   lists, tables, math, details). Media block types (collage, slideshow, map,
   etc.) can be stubs (`type RichBlockCollage = unknown`) with a TODO comment.
4. Verify whether `sendRichMessageDraft` / draft-update / draft-finalize are
   available and what their signatures are.
5. Document the minimum Telegram client app version required to render rich
   messages, if stated in the API docs.

## Scope

**Produces (new files only — no existing files modified):**
- `docs/rich-message-schema.md`
- `src/types/rich-message.ts`

**Does not produce:**
- Any changes to `src/telegram.ts`, `src/markdown.ts`, or any send path.
- No runtime behaviour change of any kind.

## Acceptance Criteria

- [ ] `docs/rich-message-schema.md` exists and contains, for each verified type:
      field name, TypeScript type, required/optional, and any documented limits.
- [ ] Schema doc notes the source URL and fetch date for traceability.
- [ ] `src/types/rich-message.ts` compiles with `tsc --noEmit` without errors.
- [ ] All `RichBlock` subtypes required for Phases 1–3 have concrete interface
      definitions (not `unknown` stubs): `RichBlockParagraph`,
      `RichBlockSectionHeading`, `RichBlockPreformatted`, `RichBlockList`,
      `RichBlockListItem`, `RichBlockTable`, `RichBlockTableCell`,
      `RichBlockMathematicalExpression`, `RichBlockDetails`.
- [ ] `InputRichMessage` interface is defined with all confirmed required fields.
- [ ] `sendRichMessage` parameter shape is documented in the schema doc.
- [ ] If draft methods are confirmed available, their signatures are documented;
      if unavailable or unconfirmed, the schema doc records that explicitly.
- [ ] **Non-regression:** `pnpm test` passes unchanged (new type file adds no
      test surface; existing tests are untouched).
- [ ] PR diff is entirely additive (new files only).

## Delegation

Executor: Worker / Reviewer: Curator

## Notes

- The grammY `^1.43.0` dependency does not expose 10.1 types. The new
  `src/types/rich-message.ts` file is intentionally separate from grammY
  imports, so it can be replaced cleanly when grammY adds 10.1 support.
- If the live docs are ambiguous on a field, note the ambiguity explicitly in
  `docs/rich-message-schema.md` — do not guess. Downstream tasks will not
  begin implementation until ambiguous fields are resolved.
- The epic mandates this task as a prerequisite for all Phase 1 implementation.
  It may run in parallel with 10-3010 (baseline snapshots).

## Overseer review

**Reviewer**: Overseer
**Date**: 2026-06-13
**Verdict**: PASS
**Review type**: Adversarial (single dispatch — Curator-authored spec, operator-greenlighted)
**Checked**: Binary ACs, scope (docs + types only, no production code), TS interface coverage, grammY gap handling, delegation
**Not checked**: Accuracy of schema against live Telegram Bot API (foreman's responsibility per spec)

## Verification

**Reviewer**: Foreman (task-verification dispatch)
**Date**: 2026-06-13
**Verdict**: APPROVED
**Merge commit**: 6aaae8c7
**Checked**:
- AC1: Schema doc with field/type/required/limits for all types ✓
- AC2: Source URL + fetch date present (core.telegram.org/bots/api, 2026-06-13) ✓
- AC3: tsc --noEmit exit code 0 (test-results.md) ✓
- AC4: All 9 Phase 1-3 RichBlock types concrete (no unknown stubs) ✓
- AC5: InputRichMessage with all confirmed required fields ✓
- AC6: sendRichMessage parameter shape documented ✓
- AC7: sendRichMessageDraft confirmed present + signature documented ✓
- AC8: pnpm test 3494/3494 pass, exit code 0 ✓
- AC9: Diff additive only — docs/rich-message-schema.md + src/types/rich-message.ts ✓
- Test gate: .worker-pod/.temp/test-results.md + test-plan.md present ✓

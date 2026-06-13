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
depends_on: ["10-3010", "10-3011", "10-3012"]
---

# 10-3013 — Rich Messages: Markdown→RichBlocks Compiler Phase 1 (Headings, Paragraphs, Code, Lists)

## Context

Epic 10-3001 §4 specifies `markdownToRichBlocks` as the heart of the epic — a
new compilation stage that converts standard Markdown into a `RichBlock[]` array
for `sendRichMessageDirect`. Phase 1 covers the core structural constructs:
headings, paragraphs with inline entities, fenced code blocks, and ordered /
unordered lists.

Tables and math are deferred to 10-3014. Streaming/partial mode is deferred to
10-3015. Routing (actually calling the compiler from send paths) is deferred to
10-3016.

**Non-regression is the #1 rule.** This task creates a new module
(`src/rich-message-compiler.ts`) and its tests. It does not touch
`src/markdown.ts`, `src/telegram.ts`, or any send path. Current rendering is
physically unaffected.

## Objective

Implement `src/rich-message-compiler.ts` exporting:

```ts
export function markdownToRichBlocks(input: string, partial?: boolean): RichBlock[]
```

The function parses standard Markdown (the same dialect agents write today) and
emits `RichBlock[]` ready for `sendRichMessageDirect`.

### Phase 1 block types (this task)

| Markdown input | Output RichBlock type |
|---|---|
| `# Heading` through `###### Heading` | `RichBlockSectionHeading` with confirmed `level` field |
| Paragraph (non-blank lines not matching other constructs) | `RichBlockParagraph` with inline `RichText` entities |
| ` ```lang\ncode\n``` ` fenced code block | `RichBlockPreformatted` with language tag |
| `- item` / `* item` unordered list | `RichBlockList` (unordered) containing `RichBlockListItem` |
| `1. item` ordered list | `RichBlockList` (ordered) containing `RichBlockListItem` |
| `> quoted` blockquote | `RichBlockBlockQuotation` |

### Inline entity extraction (inside paragraphs and list items)

The inline tokenizer must emit `RichText` leaf nodes — not re-use `markdownToV2`
output. Supported inline constructs:

- `**text**` / `*text*` → `RichTextBold`
- `_text_` → `RichTextItalic` (same identifier-boundary rule as `markdownToV2`)
- `__text__` → `RichTextUnderline`
- `~~text~~` → `RichTextStrikethrough`
- `` `code` `` → `RichTextCode`
- `[label](url)` → `RichTextAnchorLink` (or confirmed link type from 10-3011 schema)
- Plain text → plain `RichText` string node (no escaping needed — rich messages
  use structured types, not escape sequences)

### Graceful fallback contract

`markdownToRichBlocks` must never throw. If any input segment cannot be
represented as a known Phase 1 block, it is emitted as a `RichBlockParagraph`
containing the raw text. The caller (routing layer in 10-3016) handles
`RICH_MESSAGE_UNSUPPORTED` errors from the API.

### Partial mode

`markdownToRichBlocks(input, partial = true)` must produce a valid
(possibly incomplete) `RichBlock[]` as the Markdown grows. An unclosed fenced
code block in partial mode should emit what has accumulated as a
`RichBlockPreformatted` without closing fence. The contract mirrors the
`partial = true` behaviour in `markdownToV2`.

## Scope

**Produces (new file):**
- `src/rich-message-compiler.ts`
- `src/rich-message-compiler.test.ts`

**Does not modify:**
- `src/markdown.ts` — zero changes.
- `src/telegram.ts` — zero changes.
- `src/tools/send.ts` or any send sub-handler — zero changes.
- No routing; the compiler is not called from any production send path in this task.

## Acceptance Criteria

- [ ] `markdownToRichBlocks` is exported from `src/rich-message-compiler.ts`
      and accepts `(input: string, partial?: boolean): RichBlock[]`.
- [ ] All six Phase 1 block types produce the correct `RichBlock` structure as
      verified by unit tests against expected JSON shapes.
- [ ] Inline entity extraction is correct for all six inline constructs listed.
- [ ] `partial = true` mode: unclosed bold/italic/code/fenced-code produce valid
      partial output rather than throwing.
- [ ] `markdownToRichBlocks` never throws on any input (fuzz-resistant: empty
      string, all-special-chars, 10 000-char string all return an array).
- [ ] All new tests pass: `pnpm test` green.
- [ ] **Non-regression gate:** the 10-3010 snapshot suite passes unchanged —
      zero impact on `markdownToV2`, `resolveParseMode`, or any existing send path.
- [ ] `tsc --noEmit` passes.
- [ ] `grep -r markdownToRichBlocks src/tools/` returns no results (not yet
      wired into any production path).

## Delegation

Executor: Worker / Reviewer: Curator

## Notes

- The inline tokenizer can share the tokenizer logic from `markdownToV2` or be
  written fresh — whichever is cleaner. It must NOT call `markdownToV2` as a
  sub-step; the output types are different.
- `RichBlock` and `RichText` interfaces come from `src/types/rich-message.ts`
  (task 10-3011). Import from there; define nothing new inline.
- The exact discriminant field for `RichBlockList` ordered vs unordered
  (`type: "ordered_list"` vs `type: "list"` or a separate `ordered: boolean`
  field) must be taken from the 10-3011 schema doc — do not guess.
- Tables and LaTeX math are deliberately excluded. When the compiler encounters
  a GFM table (`| col | col |` with separator row), it must emit a
  `RichBlockParagraph` containing the raw table text AND log a debug note
  (`console.debug`) that the table will be handled by 10-3014.

## Overseer review

**Reviewer**: Overseer
**Date**: 2026-06-13
**Verdict**: PASS
**Review type**: Adversarial (single dispatch — Curator-authored spec, operator-greenlighted)
**Checked**: Binary ACs, scope (phase 1 block types listed, tables/math/routing deferred), partial mode contract, non-regression guard (10-3010 snapshots must stay green), delegation, dependencies clear
**Not checked**: Exact RichBlock field names (depends on 10-3011)

## Verification

**Verifier**: Dispatch agent (task-verification skill)
**Date**: 2026-06-13
**Verdict**: APPROVED

All 9 acceptance criteria confirmed:
- AC1: `markdownToRichBlocks` exported, correct signature (lines 508–519)
- AC2: All 6 Phase 1 block types correct — Paragraph, SectionHeading (`size` field), Preformatted (`language`), List (ordered+unordered), BlockQuotation — verified by tests 1–6
- AC3: All 6 inline entity types correct — AnchorLink, Code, Bold, Underline, Strikethrough, Italic — lines 82–207
- AC4: `partial=true` — unclosed fenced code emits via flushCode, no throw — tests 11–11b
- AC5: Never throws — outer try/catch safety net; empty string, all-special-chars, 10 000-char all return arrays — tests 12–13b
- AC6: `pnpm test` green — 149 test files, 3528 tests all passed
- AC7: Non-regression — `src/__snapshots__/markdown.test.ts.snap` present, all 149 test files pass, zero modifications to `src/markdown.ts`
- AC8: `tsc --noEmit` — TSC Exit: 0
- AC9: `grep -r markdownToRichBlocks src/tools/` — no results

**Squash commit**: `ee0228d` (dev)
**Sealed-By**: Foreman

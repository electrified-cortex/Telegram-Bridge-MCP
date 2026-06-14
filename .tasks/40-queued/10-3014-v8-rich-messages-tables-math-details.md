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
depends_on: ["10-3010", "10-3011", "10-3013"]
---

# 10-3014 — Rich Messages: Tables, LaTeX Math, and Collapsible Details Blocks

## Context

Epic 10-3001 §4 defers tables, math, and collapsible details to Phase 3.
Task 10-3013 builds the Phase 1 compiler; this task extends it with the three
advanced block types that are the most visually distinctive part of the
"formatting goodness" the operator wants.

**Critical GFM table note:** `markdownToV2` today escapes `|` as `\|` in plain
text. The current `send.ts` emits a warning message "markdown tables were
detected but not formatted" when it detects pipe-table syntax. Both behaviours
are snapshotted by 10-3010. This task must not change either behaviour in the
`resolveParseMode` path — it adds table support exclusively in the rich-message
compiler path, which is gated behind `RICH_MESSAGES=true`.

## Objective

Extend `src/rich-message-compiler.ts` (introduced in 10-3013) with three new
block parsers:

### 1. GFM Table → `RichBlockTable`

Detect a GFM table: a header row of `| col | col |` cells, a separator row of
`| --- | --- |`, and one or more data rows. Emit a `RichBlockTable` with:
- Header cells as `RichBlockTableCell` nodes (bold or marked, per confirmed API schema).
- Data cells as `RichBlockTableCell` nodes with inline entity support.
- Alignment hints (`:---`, `---:`, `:---:`) mapped to confirmed alignment field
  if the API supports it; ignored otherwise.

If a line block looks like a table (has `|`) but does not have a valid separator
row, fall through to `RichBlockParagraph` passthrough (same as Phase 1 fallback).

### 2. LaTeX Math → `RichBlockMathematicalExpression` / `RichTextMathematicalExpression`

Detect display math (`$$...$$`) and inline math (`$...$`) delimiters:
- `$$...$$` on its own line → `RichBlockMathematicalExpression`.
- `$...$` inside a paragraph → `RichTextMathematicalExpression` inline node
  within the surrounding `RichBlockParagraph`.

If the API does not support inline math as a `RichText` node (per 10-3011 schema),
fall through to rendering the `$...$` as plain text.

### 3. Collapsible Details → `RichBlockDetails`

Detect the collapsible-section convention. The chosen convention (default,
revisitable) is a fenced block using `:::details Title` / `:::` syntax,
modelled after VitePress/Docusaurus container directives:

```
:::details Optional title
Body content here (any Markdown blocks).
:::
```

This syntax is unambiguous: the `:::` fence cannot appear in standard CommonMark
or GFM, and the leading `details` keyword distinguishes it from other potential
future container types. It does **not** conflict with the existing `>` blockquote
syntax handled by `markdownToV2`. Document this convention in `docs/formatting.md`.
If a future API version or operator preference favours a different syntax, the
convention may be revisited — the compiler must isolate detection to a single
`parseDetailsBlock()` function to make swapping straightforward.

Emit `RichBlockDetails` with a `title` and a `body` array of `RichBlock[]`.

### Update `docs/formatting.md`

Add a section documenting which Markdown constructs trigger rich blocks when
`RICH_MESSAGES=true`, including the chosen `<details>` convention.

## Scope

**Modifies:**
- `src/rich-message-compiler.ts` — additive; no Phase 1 logic altered.
- `src/rich-message-compiler.test.ts` — additive; new test cases only.
- `docs/formatting.md` — additive section for new constructs.

**Does not modify:**
- `src/markdown.ts` — zero changes; `\|` escaping and table-warning behaviour
  are untouched.
- `src/telegram.ts`, `src/tools/send.ts`, or any existing send path — zero changes.
- Routing; the compiler is still not called from production paths
  (that is 10-3016's job).

## Acceptance Criteria

- [ ] GFM tables with valid header + separator + data rows are compiled to
      `RichBlockTable` with correct `RichBlockTableCell` children.
- [ ] A pipe character in regular prose (no separator row) is NOT treated as a
      table — it becomes plain text in a `RichBlockParagraph`.
- [ ] `$$...$$` display math compiles to `RichBlockMathematicalExpression`.
- [ ] `$...$` inline math compiles to the appropriate inline node (or plain text
      if unsupported per the schema doc from 10-3011 — behaviour documented).
- [ ] Collapsible details blocks compile to `RichBlockDetails` with title and body.
- [ ] The chosen `<details>` convention is documented in `docs/formatting.md`.
- [ ] All new compiler tests pass; `pnpm test` green.
- [ ] **Non-regression gate (critical):** the 10-3010 snapshot suite passes
      unchanged. In particular:
      - The table-warning message in `send.ts` is NOT changed.
      - `markdownToV2` output for `|` characters is NOT changed.
      - All 193 pre-existing `markdown.test.ts` tests pass.
- [ ] `tsc --noEmit` passes.
- [ ] `grep -r markdownToRichBlocks src/tools/` returns no results.

## Delegation

Executor: Worker / Reviewer: Curator

## Notes

- The GFM table detection ambiguity (prose `|` vs. table) is the highest-risk
  part of this task. The separator-row requirement (`| --- |`) is the reliable
  discriminant; the implementation must require it.
- The existing table warning path (`markdownToV2` detecting `|` and emitting
  "Note: markdown tables were detected but not formatted") is in `src/tools/send.ts`,
  not in `src/markdown.ts`. It must not be touched by this task — when
  `RICH_MESSAGES=false` (default), agents still see the warning.
- LaTeX delimiter choice (`$$` vs `\[...\]` vs custom) must match common LLM
  output patterns. `$$...$$` for display and `$...$` for inline are the most
  common; verify that `$` does not appear in enough normal prose to cause false
  positives (e.g., currency amounts like "$100"). Consider a minimum-content
  heuristic or require balanced delimiters with non-whitespace content.

## Overseer review

**Reviewer**: Overseer
**Date**: 2026-06-13
**Verdict**: PASS
**Review type**: Adversarial (2-round; round 1 failed on TBD collapsible convention; round 2 resolves with :::details fenced syntax as chosen default)
**Checked**: Collapsible convention now concrete, LaTeX ambiguity mitigated, non-regression gate, snapshot dependency, additive-only scope
**Not checked**: Exact RichBlock field names for math/details (depends on 10-3011 schema doc)

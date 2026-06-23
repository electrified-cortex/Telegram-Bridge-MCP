---
created: 2026-06-13
status: draft
priority: 10
source: Curator decomposition of epic 10-3001 (operator voice, 2026-06-11)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
epic: 10-3001-v8-rich-messages-markup
depends_on: []
---

# 10-3010 — Rich Messages: Regression Baseline (Golden Snapshot Tests)

## Context

Epic 10-3001 will add Bot API 10.1 rich-message sending alongside the existing
`resolveParseMode` / MarkdownV2 pipeline. The operator's hard constraint is:
**"without breaking how it works now."** Before any feature work begins, the
current rendering behaviour must be captured as executable golden-snapshot tests
so that every subsequent task in this epic can prove non-regression at merge time.

This task is the safety net. All other tasks in the 10-3001 epic depend on it.

## Objective

Capture the full current behaviour of `markdownToV2` and `resolveParseMode` as
Jest golden-snapshot tests in `src/markdown.test.ts` (additive — no existing
test may be modified or deleted). The snapshots become the non-regression gate
for all downstream epic tasks.

## Scope

Cover every code path that touches outbound message formatting:

1. **`markdownToV2` exhaustive input corpus** — one snapshot per construct:
   - Bold: `**text**`, `*text*`
   - Italic: `_text_`
   - Underline: `__text__`
   - Strikethrough: `~~text~~`
   - Inline code: `` `code` ``
   - Fenced code block (with language tag, without language tag)
   - Blockquote: `> line`
   - ATX headings H1–H6
   - Hyperlink: `[label](url)`
   - Plain text with every V2_SPECIAL character present
   - Markdown table (pipe syntax) — must snapshot the current warning message
   - Unordered list (`- item`, `* item`) — snapshots the current plain-text passthrough
   - Ordered list (`1. item`) — snapshots the current plain-text passthrough
   - Mixed content (heading + paragraph + code block + list in one message)
   - Partial mode (`partial = true`): unclosed bold, unclosed italic, unclosed code

2. **`resolveParseMode` paths** — one snapshot per mode:
   - `parse_mode: "Markdown"` → confirm output is MarkdownV2 string
   - `parse_mode: "MarkdownV2"` → confirm text passes through unchanged
   - `parse_mode: "HTML"` → confirm text passes through unchanged
   - `parse_mode: undefined` → confirm text passes through unchanged

3. **`buildHeader` (outbound-proxy)** — one snapshot per parse mode to lock the
   current session-name-tag formatting.

4. **Message chunking** — snapshot that a 5000-character input produces the
   same split points today (ensures chunk-boundary logic is not regressed by
   routing changes in later tasks).

Snapshot files land in `src/__snapshots__/` via Jest's standard mechanism.

## Out of scope

- No changes to existing tests.
- No changes to any source file.
- No new features.
- Does not cover send-path integration (unit snapshots of pure functions only).

## Acceptance Criteria

- [ ] All new snapshot tests are in `src/markdown.test.ts` in a clearly delimited
      `describe("regression baseline — 10-3010")` block.
- [ ] Running `pnpm test` with the new tests produces a new `.snap` file and all
      193 existing tests continue to pass.
- [ ] Every construct listed in the Scope section has at least one named snapshot.
- [ ] The Markdown-table warning path is snapshotted (ensures table-detection
      introduced in Phase 2 does not silently change the warning text).
- [ ] CI passes on the branch before the PR is opened.
- [ ] **Non-regression self-check:** the task itself introduces zero changes to
      `src/*.ts` production files; diff must show only test and snapshot additions.

## Delegation

Executor: Worker / Reviewer: Curator

## Notes

- `src/markdown.ts` is 254 lines; `src/markdown.test.ts` has 193 existing tests.
  New tests are additive only — append inside a new `describe` block.
- Snapshot format: use `toMatchInlineSnapshot` for short strings (< 120 chars)
  and `toMatchSnapshot` for multi-line output, to keep diffs readable in PR review.
- This task must be merged before any of 10-3011 through 10-3016 begins
  implementation work. Review can happen in parallel with research tasks.

## Overseer review

**Reviewer**: Overseer
**Date**: 2026-06-13
**Verdict**: PASS
**Review type**: Adversarial (single dispatch — Curator-authored spec, operator-greenlighted)
**Checked**: Binary ACs, scope (no source code changes), snapshot coverage, delegation, non-regression hard rule
**Not checked**: N/A — scope is pure additive snapshot creation

## Verification

**Reviewer**: Foreman (task-verification dispatch)
**Date**: 2026-06-13
**Verdict**: APPROVED
**Merge commit**: fa11dede
**Checked**:
- AC1: describe("regression baseline — 10-3010") block present in src/markdown.test.ts (line 224) ✓
- AC2: pnpm test → 3494 passed, exit 0; src/__snapshots__/markdown.test.ts.snap created ✓
- AC3: All 22 constructs + 4 partial-mode + 4 resolveParseMode + 3 buildHeader + 1 splitMessage named ✓
- AC4: markdown table escape-through behavior locked in snapshot ✓
- AC5: TypeScript check passed, exit code 0 ✓
- AC6: Zero production src/*.ts changes; diff shows only test + snapshot files ✓
- Test gate: .worker-pod/.temp/test-results.md and test-plan.md both present ✓

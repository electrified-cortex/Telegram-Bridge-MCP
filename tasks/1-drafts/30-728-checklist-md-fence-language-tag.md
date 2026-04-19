# 30-728 - Add language tag to fenced code block in checklist.md

## Context

GPT-5.4 audit (2026-04-19): `checklist.md:16` opens a fenced code block with no language tag, despite the workspace markdown hygiene rule requiring tagged fences (MD040).

Small, but exactly the kind of doc drift that accumulates if left.

## Acceptance Criteria

1. Open `checklist.md`, find the untagged fence at line 16.
2. Add an appropriate language tag (`text` if it's plain prose, otherwise the actual language).
3. Run markdownlint on `checklist.md` to confirm clean.

## Constraints

- Don't rewrite the block content — just add the tag.

## Priority

30 - hygiene only; safe to defer but trivial to fix in any quiet moment.

## Related

- 20-721 (parent V7 merge readiness audit).

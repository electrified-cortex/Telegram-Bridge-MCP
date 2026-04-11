---
Created: 2026-04-09
Status: Draft
Host: local
Priority: 10-431
Source: Operator (interactive testing session)
---

# Progress Bar Subtext Flexibility

## Objective

Remove the forced `<i>` (italic) wrapping from the progress bar `subtext` field
so senders control their own formatting. The title stays bold; subtext becomes
plain text.

## Context

During interactive testing, the operator noted that the subtext zone should be
flexible — not force-styled. Currently `renderProgress()` in
`src/tools/send_new_progress.ts` wraps subtext in `<i>` tags (line ~27). The
operator wants:

- **title** → bold header (`<b>`) — keep as-is
- **subtext** → plain text, no wrapping — sender decides formatting

The progress/update action handler in `src/tools/send_new_progress.ts` also uses
`renderProgress()`, so the fix propagates to updates automatically.

## Acceptance Criteria

- [ ] `renderProgress()` renders subtext without `<i>` tags
- [ ] Title still renders bold (`<b>`)
- [ ] Existing tests still pass
- [ ] Add test: subtext renders as plain text (no HTML wrapping)
- [ ] progress/update retains subtext on in-place edits

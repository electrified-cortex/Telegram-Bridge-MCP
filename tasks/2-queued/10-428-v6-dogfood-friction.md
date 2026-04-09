---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 10-428
Source: Dogfood test 10-404, findings rollup
---

# v6 API friction — dogfood findings

## Objective

Address developer experience friction discovered during dogfood testing of the
v6 API. These are not functional bugs but usability issues that make the API
harder to use correctly.

## Items

### 1. confirm buttons say "OK/Cancel" not "Yes/No" (finding 6)

Confirm prompts should default to Yes/No. Operator wants:
- `confirm/yn` preset (Yes/No) — default
- `confirm/ok` preset (OK/Cancel)
- Custom labels via params

### 2. choose param inconsistency (finding 14)

- `type: "choice"` uses `options: []`
- `type: "question"` with choose uses `choose: []`
- Same concept, different param names. Align them.

### 3. checklist status values undocumented (finding 9)

Valid statuses are `pending`, `running`, `done`, `failed`, `skipped`.
Common mistake: using `in-progress` (invalid). Help should document these.

### 4. help(topic) too sparse (finding 5)

Help responses lack parameter documentation. Agents can't discover params
without reading source. Add param descriptions to help output.

### 5. profile import requires `recurring` on reminders (finding 19)

`recurring` should default to `false`, not be required. One-off reminders
are the common case.

### 6. send_choice buttons don't persist (finding 13)

Buttons disappear after clicking. Consider option to keep buttons visible
with selected state indication (or document this as expected behavior).

### 7. single-emoji animation sticker warning (finding 10)

Single-emoji frames render as large stickers on mobile instead of inline
text. Document as a known limitation or auto-add invisible char.

## Acceptance Criteria

- [ ] Items 1-7 addressed (implemented or documented)
- [ ] Help output includes parameter info for all tools
- [ ] Schema defaults `recurring: false` on reminder import

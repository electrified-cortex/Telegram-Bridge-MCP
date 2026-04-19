---
Created: 2026-04-12
Status: Draft
Host: local
Priority: 10-501
Source: Operator directive (dogfooding critique)
---

# 10-501: Ultra-compressed profile/load response

## Objective

Make `profile/load` response ultra-compressed and actionable. Replace
opaque reminder hex IDs with a categorized count and a hint to
`reminders/list`.

## Context

Current response dumps 9 hex reminder IDs with no labels, intervals, or
descriptions. Agent has zero insight into what's scheduled.

Operator directive: "Say something simple like 'voice: onyx 1.1×.
1 startup + 5 recurring reminders active. → reminders/list for details.'"

Design principle: every hint leads to a help call or relevant tool.

## Proposed Response Format

```
voice: onyx 1.1×. 5 animation presets. N startup + M recurring reminders active.
→ help('reminders') for reminder docs. reminders/list for details.
```

Ultra compression — agents are the audience, not humans.

## Acceptance Criteria

- [ ] Profile/load response omits raw reminder hex IDs
- [ ] Response includes categorized reminder count (startup vs recurring)
- [ ] Response includes voice/speed summary
- [ ] Response includes hint to `reminders/list` for details
- [ ] Response uses ultra compression (no articles, fragments OK)
- [ ] All hints lead to a help call or relevant tool

## Completion

**Date:** 2026-04-15
**Branch:** `10-501`
**Commits:** `74e391c` (impl), `2029c33` (fix: restore loaded+key fields)

### What was done

Modified `src/tools/load_profile.ts` to replace the raw hex reminder ID dump with an ultra-compressed summary:

```
voice: onyx 1.1×. 5 animation presets. 1 startup reminder, 3 recurring. → help('reminders') for reminder docs. reminders/list for details.
```

- Counts reminders by type: `trigger === "startup"` → startup count; others with `recurring` flag → recurring count
- Includes voice name + speed only if set
- Includes preset count only if > 0
- Reminder hint appended only if reminders > 0
- ESLint: fixed `r.recurring === true` → `r.recurring` (unnecessary boolean compare)

Tests updated in `load_profile.test.ts`. 2223/2223 tests pass. Lint clean on changed files.

**Note:** 2 pre-existing ESLint errors in `session_start.ts` and `session_start.test.ts` exist on dev HEAD — not introduced by this task.

### Acceptance Criteria

- [x] Profile/load response omits raw reminder hex IDs
- [x] Response includes categorized reminder count (startup vs recurring)
- [x] Response includes voice/speed summary
- [x] Response includes hint to `reminders/list` for details
- [x] Response uses ultra compression
- [x] All hints lead to a help call or relevant tool

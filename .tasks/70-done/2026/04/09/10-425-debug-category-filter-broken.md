---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 10-425
Source: Dogfood test 10-404, row 51
---

# Debug log category filter not working in v6

## Objective

Wire up the category filter parameter for `log/debug` action path. Currently
the filter is either rejected by schema (`category`) or silently ignored (`cat`).

## Context

Dogfood row 51: The old `get_debug_log(category: "routing")` filtered entries
by category. In v6:
- `action(type: "log/debug", category: "routing")` → schema validation error
- `action(type: "log/debug", cat: "routing")` → accepted but returns all entries unfiltered

Debug entries have `cat` field in responses (e.g. `"route"`, `"animation"`).

## Acceptance Criteria

- [ ] `action(type: "log/debug", category: "route")` filters to only route entries
- [ ] Schema accepts `category` as a string parameter
- [ ] Test: verify filtering with `category: "animation"` returns only animation entries

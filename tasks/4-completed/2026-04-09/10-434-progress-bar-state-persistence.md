---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 10-434
Source: Operator testing session
---

# Progress Bar State Persistence

## Objective

When `progress/update` (or `update_progress`) is called with only `message_id` and `percent`, the title and subtext from the original `send_new_progress` call are lost. The update handler re-renders from scratch — if the caller omits title/subtext, they become `undefined` and disappear. Fix this by persisting progress bar state so updates preserve the original values.

## Context

- `send_new_progress.ts` creates the bar with optional `title` and `subtext`.
- `update_progress.ts` calls `renderProgress(percent, width, topicTitle, subtext)` using only the args passed in the update call.
- There is no in-memory store mapping `message_id` to its original title/subtext/width.
- The operator observed: created a bar with title "Test Progress" at 50%, updated to 70% — title vanished.

## Acceptance Criteria

- [ ] A `Map<number, { title?: string; subtext?: string; width: number }>` (or similar) stores state when `send_new_progress` creates a bar
- [ ] `update_progress` uses stored title/subtext/width as defaults when the caller omits them
- [ ] Explicitly passing `title` or `subtext` in the update overrides the stored value (and updates the store)
- [ ] Passing empty string (`""`) clears the stored title/subtext
- [ ] Completion tracking at 100% cleans up the stored state
- [ ] Existing tests pass; new tests cover state persistence across updates

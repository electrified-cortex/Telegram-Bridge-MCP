---
Created: 2026-04-09
Status: Complete
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

- [x] A `Map<number, { title?: string; subtext?: string; width: number }>` (or similar) stores state when `send_new_progress` creates a bar
- [x] `update_progress` uses stored title/subtext/width as defaults when the caller omits them
- [x] Explicitly passing `title` or `subtext` in the update overrides the stored value (and updates the store)
- [x] Passing empty string (`""`) clears the stored title/subtext
- [x] Completion tracking at 100% cleans up the stored state
- [x] Existing tests pass; new tests cover state persistence across updates

## Completion

**Branch:** `10-434` · **Commit:** `e996b41`

### Changes

- **`src/progress-store.ts`** (new) — `ProgressState` interface and `Map`-backed store with `setProgressState`, `getProgressState`, `deleteProgressState`, `resetProgressStoreForTest`
- **`src/tools/send_new_progress.ts`** — calls `setProgressState` after sending message
- **`src/tools/update_progress.ts`** — resolves title/subtext/width from store when caller omits them; updates store on explicit overrides; deletes store entry at 100%; schema changed `width` from `.default()` to `.optional()` to distinguish "omitted" from "passed explicitly"; store only updated for tracked messages (prevents phantom entries for arbitrary message IDs)
- **`src/tools/send_new_progress.test.ts`** — 1 new test for state storage
- **`src/tools/update_progress.test.ts`** — 7 new tests covering all persistence scenarios

### Code Review Findings (resolved)

- **Major:** Phantom store entries for untracked messages — fixed by guarding `setProgressState` with `if (stored !== undefined)`
- **Minor:** Redundant store write at 100% — accepted as harmless; `deleteProgressState` immediately follows
- **Info:** Empty-string-clears convention is in the Zod schema description for the tool

### Test Results

2170/2170 passing (107 test files)

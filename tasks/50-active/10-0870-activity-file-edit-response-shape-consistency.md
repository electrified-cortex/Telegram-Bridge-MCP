---
id: "10-0870"
title: "Align activity/file/edit response shape with create (drop ok+tmcp_owned, add hint)"
type: chore
priority: 50
status: queued
created: 2026-05-05
repo: Telegram MCP
delegation: Worker
depends_on: []
---

# Align activity/file/edit response shape with create

## Context (2026-05-05)

`activity/file/create` was reshaped this session: dropped `ok` and `tmcp_owned`, added a `hint` field telling the caller what to do with the file. New shape:

```json
{ "file_path": "...", "hint": "Configure your watcher to call dequeue() when this file changes" }
```

Sibling endpoint `activity/file/edit` was NOT touched in the same pass. It still emits the old shape:

```json
{ "ok": true, "file_path": "...", "tmcp_owned": false, "previous_path": "..." }
```

That's inconsistent at the API surface. Either both endpoints need the same self-documenting shape, or callers will keep parsing `ok`/`tmcp_owned` from edit and `hint` from create.

## Fix

Edit `src/tools/activity/edit.ts` — both `toResult` sites (lines 56 and 79) and the JSDoc header (line 7).

Target shape:

```json
{ "file_path": "...", "hint": "Configure your watcher to call dequeue() when this file changes", "previous_path": "..." }
```

Keep `previous_path` — it's the only edit-specific field and tells the caller what was unregistered. Drop `ok` and `tmcp_owned` to match create.

## Build + test

Run `pnpm build` and `pnpm test`. No existing tests reference the old shape (verified via grep on `src/tools/activity/`), so build is the main signal.

## Acceptance criteria

- Both `toResult` sites in `edit.ts` emit `{ file_path, hint, previous_path }`.
- JSDoc updated.
- `pnpm build` green.
- `pnpm test` green.
- No callers break (in-tree consumers checked: none read `ok` or `tmcp_owned` from edit response).

## Out of scope

- `activity/file/get` and `activity/file/delete` response shapes — separate review (their fields may be fine as-is or need similar treatment; not part of this task).
- Build + release coordination — the create-side change is also unbuilt. Whoever picks this up should batch the build/release with create's change.

## Dispatch

Worker, Haiku — mechanical edit + build + test.

## Bailout

30 min. If `pnpm build` fails on something unrelated, surface to Curator with the error.

## Notes

- Origin: operator asked for the shape change on `create.ts` only (msg ~13:35Z, 2026-05-05); this task picks up the sibling.
- See `src/tools/activity/create.ts` (post-change) for the reference shape.
- `tmcp_owned` is still tracked internally in `file-state.ts` for cleanup; agents don't need it in the response.

# 054 — Fix save_profile bugs + content-hash reminder IDs

## Problem

Three bugs in `save_profile` plus a design improvement for reminder IDs:

1. **`animation_default` saved unconditionally** — `getDefaultFrames(sid)` falls back to `DEFAULT_FRAMES` when no custom default is set. The save serializes this hardcoded bounce animation into every profile even when the session never customized it.

2. **Reminder GUIDs persisted** — `save_profile` copies `r.id` (the runtime UUID) into the profile. These IDs are meaningless as templates.

3. **Checked-in `profiles/Overseer.json`** — already cleaned (no `animation_default`, no GUIDs), but code still produces them.

4. **Random UUIDs cause duplicates on reload** — calling `load_profile` twice creates duplicate reminders because each load generates fresh random IDs that don't match existing ones.

## Design: Content-Hash Reminder IDs

Replace random UUIDs with a deterministic hash of `text + recurring`:

- Hash inputs: `text` (string) + `recurring` (boolean). **Not** `delay_seconds` — so changing the period for the same reminder overrides in place.
- Hash algorithm: SHA-256 truncated to 16 hex chars (64 bits — collision-safe for ≤20 reminders per session).
- `set_reminder` uses content hash as default ID when no explicit `id` is provided.
- `addReminder` dedup logic stays the same — same ID replaces in place.
- Loading the same profile twice is now idempotent (same text+recurring → same hash → replace, not duplicate).
- A one-shot and recurring version of the same text get different hashes and coexist.

### Load-profile output enrichment

`load_profile` should report which reminders were **added** (fresh) vs **updated** (overrode existing):

```json
{
  "reminders": {
    "added": ["abc123...", "def456..."],
    "updated": ["ghi789..."]
  }
}
```

If all are added and none updated, the agent knows it's a clean load. If any were updated, the response should include a `review_recommended` flag.

## Changes

### A. `src/reminder-state.ts`

Add a helper to compute the content hash:

```ts
import { createHash } from "crypto";

export function reminderContentHash(text: string, recurring: boolean): string {
  return createHash("sha256")
    .update(`${text}\0${recurring}`)
    .digest("hex")
    .slice(0, 16);
}
```

### B. `src/tools/set_reminder.ts`

Change the default ID from `crypto.randomUUID()` to `reminderContentHash(text, recurring)`.

### C. `src/animation-state.ts`

Export a new function:

```ts
export function hasSessionDefault(sid: number): boolean {
  return _sessionDefaults.has(sid);
}
```

### D. `src/tools/save_profile.ts`

1. Import `hasSessionDefault` from `../animation-state.js`.
2. Only save `animation_default` when `hasSessionDefault(_sid)` is true.
3. Strip `id` from reminder serialization — profiles are templates, IDs are derived on load.

### E. `src/profile-store.ts`

Remove `id` from `ReminderDef`:

```ts
export interface ReminderDef {
  text: string;
  delay_seconds: number;
  recurring: boolean;
}
```

### F. `src/tools/load_profile.ts`

1. Generate ID via `reminderContentHash(r.text, r.recurring)` instead of `crypto.randomUUID()`.
2. Before calling `addReminder`, check if a reminder with that ID already exists → track as "updated" vs "added".
3. Return enriched output: `{ added: [...], updated: [...], review_recommended: boolean }`.

### G. Tests

- Update `src/profile-store.test.ts` — remove `id` from test data.
- Add test: content hash is deterministic (same text+recurring → same hash).
- Add test: different recurring flag → different hash.
- Add test: saving a profile without custom animation default omits `animation_default`.
- Add test: saved reminders never contain `id`.
- Add test: loading same profile twice doesn't duplicate reminders.
- Add test: load_profile output distinguishes added vs updated.

## Acceptance criteria

- [ ] `pnpm build` clean
- [ ] `pnpm test` — all pass, no regressions
- [ ] `pnpm lint` clean
- [ ] `profiles/Overseer.json` has no `animation_default` and no reminder `id` fields
- [ ] Saving a profile without custom animation default omits `animation_default`
- [ ] Saved reminders never contain `id`
- [ ] `set_reminder` without explicit `id` uses content hash
- [ ] Loading same profile twice is idempotent (no duplicates)
- [ ] `load_profile` output shows added vs updated reminders

## Files

| File | Action |
| --- | --- |
| `src/reminder-state.ts` | Add `reminderContentHash` helper |
| `src/tools/set_reminder.ts` | Use content hash as default ID |
| `src/animation-state.ts` | Add `hasSessionDefault` export |
| `src/tools/save_profile.ts` | Conditional animation, strip reminder id |
| `src/profile-store.ts` | Remove `id` from `ReminderDef` |
| `src/tools/load_profile.ts` | Content-hash IDs, enriched output |
| `src/profile-store.test.ts` | Update + new tests |
| `changelog/unreleased.md` | Document fix |

## Completion

**Date:** 2026-03-22
**Status:** Done

### Files Modified

- src/reminder-state.ts — added 
eminderContentHash(text, recurring) export (SHA-256/16 hex)
- src/animation-state.ts — added hasSessionDefault(sid) export
- src/tools/save_profile.ts — only saves nimation_default when custom; strips id from reminder serialization
- src/tools/set_reminder.ts — uses 
eminderContentHash as default ID instead of crypto.randomUUID()
- src/tools/load_profile.ts — uses 
eminderContentHash for IDs; tracks added vs updated; returns enriched reminder summary with 
eview_recommended
- src/profile-store.ts — removed id? field from ReminderDef interface
- changelog/unreleased.md — added Fixed and Changed entries per spec

### Tests Added/Updated

- src/reminder-state.test.ts — added 
eminderContentHash suite (4 tests: deterministic, length, recurring diff, text diff)
- src/tools/set_reminder.test.ts — added content hash mock; added test for default ID via content hash; updated module mock to include 
eminderContentHash
- src/tools/save_profile.test.ts — new file, 9 tests covering: omits animation_default when no custom default, includes when custom, reminders never contain id, identity gate, etc.
- src/tools/load_profile.test.ts — new file, 8 tests covering: uses content hash IDs, idempotent double-load, added vs updated tracking, review_recommended flag, identity gate

### Results

- pnpm build — clean
- pnpm test — 93 files, 1720 tests, all pass
- pnpm lint — clean
- profiles/Overseer.json — untouched (confirmed no animation_default or id fields)

---
id: 15-0837
title: Event endpoint — preset name == event kind (drop hardcoded KIND_ANIMATION map)
priority: 15
status: draft
type: refactor
delegation: any
---

# Event endpoint — preset name == event kind

When a governor event fires, look up an animation preset with the **same name as the event kind** and run it. End of story. No hardcoded `kind → preset` table; convention over config.

## Why

- The current hardcoded `KIND_ANIMATION` map (`compacting → working`, etc.) couples event semantics to specific built-in presets and bakes in mismatches (e.g. `compacting` should not reuse `working`).
- Agents already have a profile preset library; letting kind name == preset name lets each agent ship its own visual identity per kind without bridge edits.
- Adding a new event kind (e.g. `recovering`) becomes "register the `recovering` preset" instead of "ship a TMCP code change".

## Acceptance criteria

1. `src/event-endpoint.ts`: remove the `KIND_ANIMATION` const. The governor side-effect block becomes:
   - `compacted` (special case kept, see below): cancel any active animation **and** fire the `recovering` preset if registered, with ~60 s auto-cancel timeout.
   - All other governor kinds: call `handleShowAnimation({ token, preset: kind })`. If `getPreset(sid, kind)` returns no frames, the animation tool returns `UNKNOWN_PRESET` and nothing renders — that is the correct silent fallback.
2. `src/animation-state.ts` `BUILTIN_PRESETS`: replace single-frame `compacting` entry with multi-frame dot-family animation, same style as `working`/`thinking`/`loading`. Word: `compacting`.
3. `src/animation-state.ts` `BUILTIN_PRESETS`: add `recovering` preset, dot-family. Word: `recovering from compaction` (or shorter if the line is too wide).
4. Tests:
   - Governor `compacting` event → `handleShowAnimation` called with `preset: "compacting"`.
   - Governor `compacted` event → cancel + `handleShowAnimation` with `preset: "recovering"` and a ~60 s timeout.
   - Governor `startup` event → `handleShowAnimation` with `preset: "startup"` (no built-in needed; if absent, silent no-op).
5. Manual smoke test: governor POSTs `compacting` → animated frames; POSTs `compacted` → recovering animation runs ~60 s or until next outbound replaces it.

## Out of scope

- Removing the kind allow-list at the endpoint layer — paired metrics (compacting/compacted, shutdown_warn/shutdown_complete) still rely on a known kind set; leave the allow-list alone.
- Per-session timeout config — 60 s is the agreed default for `recovering`.

## Notes

- Discovered 2026-04-25 during operator's smoke test of the v7.2.0 `/event` endpoint. Operator's simplification request: stop hardcoding kind→preset mappings; let preset name == kind.
- The `compacted` branch keeps the cancel-then-fire-recovering shape because operator wants the post-compaction animation to be visibly different from in-flight compacting, and the cancel guarantees a clean handoff.

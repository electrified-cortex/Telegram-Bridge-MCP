---
Created: 2026-04-09
Status: Queued
Host: local
Priority: 35-441
Source: Operator
---

# Custom Name Tag Emoji

## Objective

Allow sessions to customize the robot emoji (🤖) in their name tag. Currently the name tag renders as `[color_square] [🤖] [session_name]` (e.g. "🟦 🤖 Curator"). The operator wants the ability to change the robot emoji to a different one (e.g. ⚙️, 🧠, ⚡, or a custom worker icon) per session.

## Context

- Name tags currently render as `[color_square] [robot_emoji] [session_name]`.
- The color square is already customizable. The robot emoji is hardcoded.
- The operator wants a session-level setting to replace the robot emoji with a custom one.
- This could be set at session start, via profile, or via a session command.
- The robot emoji is great as a default — this is about allowing personalization.

## Acceptance Criteria

- [ ] Sessions can specify a custom emoji to replace the robot emoji in their name tag
- [ ] Custom emoji replaces only the robot emoji; color square remains unchanged
- [ ] Setting is saveable via profile (persists across sessions)
- [ ] Falls back to robot emoji (🤖) if no custom emoji is set
- [ ] Existing tests pass

## Completion

Implemented in worktree `35-441`, commit `2b7d047`.

**Changes:** `Session.nametag_emoji` field; `ProfileData.nametag_emoji`; `buildHeader()` reads `session?.nametag_emoji ?? "🤖"` across all parse modes; `apply-profile`, `save_profile`, `import_profile`, `action.ts` wired up; schema `string().min(1).max(10).optional()`; tests added in `outbound-proxy.test.ts` and `save_profile.test.ts`.

**Build:** tsc PASS, vitest 2606/2606 PASS. Lint: 3 pre-existing errors on dev in `tool-hooks.ts` and `session_status.ts` (not in this diff — Overseer confirmed out of scope).

**Code review:** 1 smoke pass (clean) + 4 substantive passes. Sign-off pass verdict: `findings` — 1 major accepted by Overseer (session-not-found silent skip is by design; session always exists post-auth), 1 nit (false positive: reviewer incorrectly stated `clearAllMocks` subsumes `mockReset`; the explicit reset is required due to preceding test's `mockImplementation`).

**Preserved contradictions:**
- Pass 4 nit on `save_profile.test.ts:132` contradicted: `vi.clearAllMocks()` calls `mockClear()` which does NOT reset `mockImplementation`. The `mockReset()` is required to neutralise the throw set by the preceding test.

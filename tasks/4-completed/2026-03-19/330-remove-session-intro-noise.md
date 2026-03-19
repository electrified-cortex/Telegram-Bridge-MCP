# Remove session intro noise from session_start

**Type:** UX / cleanup
**Priority:** 330
**Source:** Operator feedback (2026-03-19)

## Problem

`session_start` sends an intro message that duplicates information the agent is about to communicate itself. The tool currently sends things like:

```
ℹ️ Session 1 — 🟦 Overseer (reconnected)
```

This is noisy. Agents introduce themselves via their first real message. The built-in intro adds clutter without adding value — especially in multi-session mode where agents are expected to send a proper opening message anyway.

## Fix

Remove or minimise the auto-intro message sent by `session_start`.

**Option A — Remove entirely:** Don't send any message; return `intro_message_id: null`. Agents introduce themselves.

**Option B — Minimal silent marker:** Send a minimal `disable_notification: true` message (e.g. just a session ID marker) but don't surface it as a user-facing message. Keeps `intro_message_id` in return value for ordering reference.

Prefer **Option A** unless there is a specific technical reason the intro message is needed (e.g. used as an anchor for reply threading).

If the `intro` parameter and `buildIntro()` become dead code after this change, remove them too.

## Code Path

- `src/tools/session_start.ts` — `buildIntro()` function and the `sendMessage(introText)` call
- `src/tools/session_start.test.ts` — tests covering intro message content

## Acceptance Criteria

- [ ] `session_start` no longer sends a user-visible intro message (or sends nothing)
- [ ] `intro_message_id` removed from return value, or documented as intentionally absent
- [ ] `intro` parameter removed from tool schema (or deprecated with a note) if it's dead code
- [ ] `buildIntro()` removed if no longer used
- [ ] All tests updated to match new behaviour
- [ ] Typecheck clean — `pnpm typecheck`
- [ ] Lint clean — `pnpm lint`
- [ ] All tests pass — `pnpm test`
- [ ] `changelog/unreleased.md` updated under `## Changed`

## Completion

**Completed:** 2026-03-19

Option A implemented. Removed uildIntro(), DEFAULT_INTRO, DEFAULT_RECONNECT_INTRO, the `intro` input parameter, and `intro_message_id` from result. All 1473 tests pass, typecheck and lint clean.

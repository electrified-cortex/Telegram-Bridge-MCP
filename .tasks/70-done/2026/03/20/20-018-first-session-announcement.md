# Task #018 — First Session Announcement

| Field    | Value                                          |
| -------- | ---------------------------------------------- |
| Priority | 20 (medium-high — UX gap noticed by operator)  |
| Created  | 2026-03-19 (refined from backlog)              |

## Goal

When the first session connects (auto-approved, no operator gate), send a visible announcement message in the Telegram chat so the operator knows a session is online.

## Strategy

**Branch from:** `master`
**Worktree:** `20-018-first-session-announcement`
**Branch name:** `task/018-first-session-announcement`
**Separate PR:** Yes — targets `master`

Small, focused change in `session_start.ts`. Low risk.

## Scope

In `src/tools/session_start.ts`, after the first session is auto-approved:

1. Send an announcement message to the chat (same format as post-approval announcement for 2nd+ sessions)
2. Track the message with `trackMessageOwner()` so replies route correctly
3. Include `announcement_message_id` in `session_orientation` service event details
4. Assign first available color from palette

## Key Files

- `src/tools/session_start.ts` — main change
- `src/tools/session_start.test.ts` — add test for first-session announcement
- `changelog/unreleased.md`

## Acceptance Criteria

- [ ] First session sends visible announcement in chat
- [ ] Announcement format matches 2nd+ session announcements
- [ ] Message tracked for reply routing
- [ ] `announcement_message_id` in service event details
- [ ] Tests cover first-session announcement path
- [ ] Build + lint clean

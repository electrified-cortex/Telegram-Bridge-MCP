---
id: "10-0879"
title: "Async messages queued at session close lose proper name tag"
type: bug
priority: 30
status: draft
created: 2026-05-05
filed-by: Curator
delegation: Worker
target_repo: telegram-bridge-mcp
---

# Async send + session close = name tag lost

## Operator framing (2026-05-05, msg 50321)

> "When she shut down — the message that there was an async message sent and then she shut down, that was really cool. But then her name tag, basically because her session was closed, that particular message did not complete correctly with the right name tag. It's a bug, not a very high priority one, but we should log it. If there's N number of messages queued up, and then an entity or session decides to close or whatever, those should still resolve with the proper name tag."

## Observed

When Overseer (SID 3) closed today, an async voice message she had queued resolved AFTER the session closed. The message rendered without the proper name tag (custom or default) — because the session that owned the message was already gone, and the outbound proxy couldn't look up the name tag from a dead session.

## Goal

Async messages queued before session close should still resolve with the correct name tag — captured at enqueue time, not at send time.

## Acceptance criteria

- Investigate the async-message render path. Identify where the name tag is looked up.
- Capture the name tag (custom or default) AT ENQUEUE TIME and attach it to the queued message payload, so render time doesn't depend on the session still existing.
- Add a regression test: queue an async message for a session, close the session before the message renders, confirm the rendered message has the correct name tag.
- Behavior on completely missing session (e.g., process restart between enqueue and send): graceful fallback — render with the captured name tag still attached, no error.

## Out of scope

- Synchronous messages (already render with live session context).
- Cross-session message routing (separate concern).

## Bailout

- 60 min impl cap. If the fix requires invasive refactor of the queue/sessions interaction, surface and stop.

## Priority

Low (30) — operator flagged "not very high priority." Cosmetic bug, no functional loss; just incorrect rendering on edge case.

## Related

- 10-0869 (custom name tags — possibly related rendering path).
- Memory `feedback_telegram_session_lifecycle.md` (session shutdown / drain semantics).

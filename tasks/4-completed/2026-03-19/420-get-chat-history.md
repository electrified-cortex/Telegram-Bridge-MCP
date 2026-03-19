# 420 — Add `get_chat_history` tool for reading recent messages

## Motivation

Sessions currently have no way to review past conversation history. When a new session joins, or a worker finishes a long task, they can't see what happened in the chat before they started listening. This tool solves that — like scrolling up in a group chat.

## Tool Design

**Name:** `get_chat_history`

**Parameters:**

- `count` (number, default 20, max 50) — how many events to return
- `before_id` (number, optional) — return events older than the event with this ID (for paging backwards). Omit for the most recent events. **Note:** this uses the event's *position* in the timeline, not numeric comparison — because IDs aren't monotonic (service messages use negative IDs like -100000, DMs use -1, -2, etc.).
- `identity` — standard identity tuple for auth

**Returns:**

```json
{
  "events": [ /* TimelineEvent objects without _update */ ],
  "has_more": true
}
```

- `events` — array of up to `count` events, ordered oldest-first (chronological, matching timeline order)
- `has_more` — boolean, true if there are older events beyond the returned window

## Implementation

**Model after:** `src/tools/get_message.ts` — same auth pattern (`requireAuth`, `IDENTITY_SCHEMA`), same import structure, same `toResult`/`toError` return style.

### File: `src/tools/get_chat_history.ts`

1. Import `dumpTimeline` from `../message-store.js` — this returns the full timeline (up to 1000 events) without `_update` fields.
2. Auth gate: use `requireAuth(identity)` from `../session-gate.js`.
3. Filter logic:
   - Get the full timeline via `dumpTimeline()`
   - If `before_id` is specified, find the **position** (index) of the event with that ID in the timeline array, then take up to `count` events before that index. Do NOT compare IDs numerically — IDs are not monotonic (negatives for service/DMs).
   - If `before_id` not found, return an error
   - If no `before_id`, take the last `count` events from the end
   - Keep chronological (oldest-first) order
4. Set `has_more = true` if there are events older than the returned window.
5. Return `{ events, has_more }`.

### File: `src/message-store.ts`

`dumpTimeline()` already exists and returns `Array<Omit<TimelineEvent, "_update">>`. No changes needed.

### Registration: `src/server.ts`

Add `import { register as registerGetChatHistory } from "./tools/get_chat_history.js";` and call `registerGetChatHistory(server)` alongside the other tool registrations.

## Key decisions

- **No DM filtering.** The timeline contains DMs between other sessions, service messages, etc. For now, return everything. The agent can decide what's relevant. If privacy is needed later, we can add filtering in a follow-up.
- **Oldest-first (chronological).** Events returned in timeline order. Paging goes backwards via `before_id`.
- **No `after_id`.** Forward paging isn't needed — that's what `dequeue_update` is for.

## Acceptance Criteria

- [x] `get_chat_history()` returns the last 20 events by default
- [x] `get_chat_history(count: 5)` returns only 5 events
- [x] `get_chat_history(before_id: X)` returns events before ID X
- [x] `has_more` is true when older events exist
- [x] `has_more` is false when the returned window includes the oldest event
- [x] Auth gate: returns error if identity is invalid
- [x] Tool is registered in `server.ts`
- [x] Tests file: `src/tools/get_chat_history.test.ts`
- [x] `npx vitest run` — all tests pass
- [x] `npx tsc --noEmit` clean
- [x] `npx eslint src/` clean

## Completion

**Completed:** 2026-03-19

Implemented `get_chat_history` in `src/tools/get_chat_history.ts` using `dumpTimeline()`, `requireAuth(identity)`, `count` windowing, and `before_id` index-based backward paging. Registered the tool in `src/server.ts` and added coverage in `src/tools/get_chat_history.test.ts`.

Verification:

- `npx vitest run` passed
- `npx tsc --noEmit` passed
- `npx eslint src/` passed

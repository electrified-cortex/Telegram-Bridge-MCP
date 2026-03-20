# Task #030 — Investigate Voice Reply Routing to Worker Sessions

| Field    | Value                                             |
| -------- | ------------------------------------------------- |
| Priority | 10 (investigation — diagnostic only)              |
| Created  | 2026-03-20                                        |
| Type     | **Investigation** — report findings, do not fix   |

## Problem

When the operator replies (voice or text) to a message sent by a worker session (SID 2), the reply is not routed to the worker's queue. Instead it falls through to the governor (SID 1).

## Evidence

Debug routing log from live session shows **1 of 183 routing decisions** reached worker SID 2:
- `"targeted event=11373 → sid=2"` — text reply to worker's announcement message (11372)
- Every other message → SID 1

Worker SID 2 sent only two messages in the session: announcement (11372) and a rename prompt (11375). The text reply to 11372 routed correctly, suggesting ownership tracking works for at least some messages.

## Investigation Scope

### 1. Ownership tracking coverage

In `src/message-store.ts`, `recordOutgoing()` calls `trackMessageOwner(messageId, activeSid)` at line ~465 using `sid ?? getCallerSid()`.

- **Question:** Are there outbound paths that bypass `recordOutgoing()`? (direct `bot.sendMessage` calls, outbound proxy shortcuts, etc.)
- **Question:** Does `getCallerSid()` return the correct SID for worker tool calls? Trace the `callerSid` lifecycle.

### 2. Reply-to resolution

In `src/session-queue.ts`, `resolveTargetSession()` checks `event.content.reply_to` → `getMessageOwner(reply_to)`.

- **Question:** Is `reply_to` populated correctly for voice messages? Check the update sanitizer (`src/update-sanitizer.ts`) to see if `reply_to_message.message_id` is extracted for voice updates.
- **Question:** Could `reply_to` be set to the *user's* message ID instead of the bot's message ID? If so, ownership lookup would miss.

### 3. Confirm/choose button messages

Confirm and choose tools generate inline-keyboard messages. When workers use these tools:

- **Question:** Is the resulting bot message tracked with the worker's SID?
- **Question:** Do callback responses route back via `event.content.target`?

### 4. Edited messages

If a bot message is edited (e.g., progress updates, checklist updates), does the *edited* message retain ownership? `recordOutgoingEdit()` doesn't call `trackMessageOwner()`.

## Deliverables

1. A written analysis answering each question above with code references
2. Identification of which outbound paths (if any) fail to call `trackMessageOwner()`
3. Reproduction steps: a minimal scenario where a worker-sent message is not ownership-tracked
4. Append findings to this task file under `## Findings`

## Files to Read

- `src/session-queue.ts` — routing logic, `trackMessageOwner`, `resolveTargetSession`
- `src/message-store.ts` — `recordOutgoing`, `recordOutgoingEdit`, `getCallerSid`
- `src/outbound-proxy.ts` — outbound recording, proxy layer
- `src/update-sanitizer.ts` — inbound `reply_to` extraction
- `src/tools/` — confirm, choose, send_message tools (check SID propagation)
- `src/routing-mode.ts` — governor SID management

## Findings

### Q1 — Outbound paths bypassing `trackMessageOwner()`

**One path intentionally bypasses all recording:** `bypassProxy()` in `animation-state.ts`.
The flag `_bypassing` causes the proxy to skip all hooks (typing cancel, recording, animation).
These sends are animation system internals (placeholder messages, deletions) and are not
intended to be ownership-tracked. Animation placeholder IDs are tracked via `trackMessageId()`
for highwater-mark only — not for routing.

**All other outbound paths correctly call `recordOutgoing()` → `trackMessageOwner()`:**

| Path | Tracking? |
|---|---|
| `getApi().sendMessage()` → proxy → `recordOutgoing()` | ✓ |
| `getApi().sendPhoto/Video/Audio/Document()` → proxy → `recordOutgoing()` | ✓ |
| `sendVoiceDirect()` → `notifyAfterFileSend()` → `recordOutgoing()` | ✓ |
| `bypassProxy()` (animation system) | ✗ intentional |

**`recordOutgoingEdit()` does NOT call `trackMessageOwner()`** — but this is safe because
the original entry in `_messageOwnership` from the initial `recordOutgoing()` call is never
removed (only cleaned up when `removeSessionQueue()` is called at session teardown).
Edited messages retain their original ownership correctly.

**Code refs:** `src/outbound-proxy.ts` lines 90–107 (`bypassProxy`), 180–220 (proxy sendMessage),
`src/message-store.ts` lines 448–466 (`recordOutgoing` → `trackMessageOwner`),
`src/message-store.ts` lines 468–514 (`recordOutgoingEdit` — no `trackMessageOwner` call).

### Q2 — `reply_to` for voice messages in `recordInbound`

`reply_to` **is correctly populated for voice messages.** In `recordInbound()`
(`src/message-store.ts`), `reply_to` is set *after* `buildMessageContent()` returns:

```typescript
const content = buildMessageContent(msg, transcribedText);
if (msg.reply_to_message) {
  content.reply_to = msg.reply_to_message.message_id;
}
```

This executes for ALL message types including voice. The `update-sanitizer.ts` path
(for `get_update`/`get_updates`) also includes `reply_to_message_id` via `base` spread for
voice messages, but the sanitizer is for agent-readable output only and does not affect routing.

**Subquestion — is `reply_to` the bot's message ID or the user's?**

When the operator uses Telegram's **explicit Reply** feature on a *bot* message, the
`reply_to_message.message_id` is the bot's message ID → correctly found in `_messageOwnership`.
When the operator replies to their *own* message (user → user), that ID is not in
`_messageOwnership` → `getMessageOwner()` returns 0 → falls through to governor.
This is correct behavior, not a bug.

### Q3 — Confirm/choose message SID tracking

Confirm and choose messages **are ownership-tracked with the correct worker SID:**

1. `server.ts` wraps ALL tool calls in `runInSessionContext(sid, ...)` using `identity[0]`
   (lines 103–111) — ALS is always set.
2. `getApi().sendMessage()` inside `confirm.ts` → proxy → `proxiedSendMessage` calls
   `getCallerSid()` (from ALS) → `recordOutgoing()` → `trackMessageOwner(msgId, workerSid)`.
3. Callback queries route via `event.content.target` → `getMessageOwner(target)` → worker SID
   → `enqueueToSession(workerSid, event)`. ✓

No gap identified. Callbacks on confirm/choose buttons route back to the originating worker.

### Q4 — Edited messages retain ownership

**Yes, edited messages retain ownership.** `recordOutgoingEdit()` does not call
`trackMessageOwner()`, but the `_messageOwnership` map entry set by `recordOutgoing()` on
initial send is never overwritten or removed during the session lifetime. A reply to an edited
bot message routes to the same owning session as before the edit.

### Root cause of "1 of 183 routing to worker"

**The routing behavior is working exactly as designed.** Routes to worker only when:
1. Operator uses Telegram's explicit **Reply** on a bot message owned by worker
2. Operator presses a **button** on a message owned by worker (callback query)
3. Operator sets a **reaction** on a message owned by worker

Without one of these, every message is "ambiguous" → governor (SID 1).

The live session evidence (only 1 targeted event: text reply to announcement msg 11372) is
consistent with an operator sending voice messages as new conversations, not as explicit
Telegram replies to worker messages. **No bug — operator workflow mismatch with routing design.**

### Minimal reproduction: untracked worker message

**Scenario where a worker-sent message would NOT be ownership-tracked (bypassing proxy):**

```typescript
// Inside animation-state.ts internals
bypassProxy(() => getRawApi().sendMessage(chatId, "placeholder"));
// → _bypassing = true → proxy skips recordOutgoing → no trackMessageOwner call
// → any reply to this message goes to governor, not the animation-owning session
```

This applies to animation placeholder messages. They are intentional ephemeral sends and
the operator is not expected to reply to them. Functionally not a routing bug.

### Conclusion

No actionable bugs found in the ownership tracking or reply routing pipeline.
The architecture correctly routes replies and callbacks but cannot route free-standing
messages (voice or text sent without Telegram's Reply feature) to workers.
That is a design constraint, not a defect. See `docs/inter-agent-communication.md` for
the intended operator workflow for directing messages to workers.

## Completion

| Field | Value |
|---|---|
| Completed | 2026-03-20 |
| Implemented by | Worker (SID 2) |
| Branch | n/a — investigation only |

**Result:** No code changes required. Full analysis written above.

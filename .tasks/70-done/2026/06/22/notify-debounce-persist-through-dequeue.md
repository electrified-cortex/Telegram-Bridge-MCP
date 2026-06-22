# Fix: notify-debounce must persist through successful dequeues

**Status:** operator-approved, urgent  
**Source:** dogfood observation 2026-06-22 (Curator session startup)  
**Operator:** "want this in ASAP"

---

## Problem

The current `notify-debounce` resets on every successful dequeue (one with content returned). This causes the bridge to re-notify the agent on every new message even if the agent just received a notify moments ago.

**Observed evidence:** During Curator startup, the agent was receiving one SSE `notify` per dequeue-drain cycle — getting re-notified immediately after each successful drain, with no debounce suppression window in effect.

## Intended behavior

> Notify fires → 5-min debounce window starts → new messages arriving within that window do NOT fire another notify.
>
> The debounce is only **cancelled** when the agent calls `dequeue` and gets `timed_out: true` (meaning the agent was idle, waiting for content, and nothing arrived during the wait). This signals the agent is caught up and ready to receive fresh notifies.

In other words:

| Dequeue result | Debounce effect |
|---|---|
| Returns content (`updates: [...]`) | Debounce continues — no new notify yet |
| Returns `timed_out: true` | Debounce cancelled — next message fires notify immediately |
| Returns empty (instant poll) | No change to debounce |
| Debounce window expires naturally (5 min elapsed) | Debounce cancelled — next message fires notify immediately |

## Why this makes sense

The goal of the debounce is: "don't spam the agent." If the agent is actively draining messages, it already knows new content arrived — it doesn't need a fresh notify for each one. The agent should call `dequeue` again because `pending > 0`, not because SSE woke it.

The `timed_out` path means: "the agent went back to waiting and found nothing." At that point it's safe to assume the agent is in a clean idle state and a fresh notify on the next message is warranted.

## Fix scope

- `notifyChannelSubscriber` / debounce reset logic in session/dequeue handler
- Only cancel debounce timer when `timed_out: true` is returned, not on normal content-bearing dequeue responses
- Cover with a test: rapid message sequence, agent dequeues content each time → verify only ONE notify fires across the sequence

## Notes

- The 5-min window value may be configurable via `profile/notify-debounce`
- This is separate from `notify-gate` (post-send lockout) — don't conflate
- Does not affect `timed_out: true` path — that should still immediately re-arm

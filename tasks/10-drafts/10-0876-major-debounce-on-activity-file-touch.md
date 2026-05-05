---
id: "10-0876"
title: "Major debounce on activity-file mtime touches — only kick when truly idle"
type: bug
priority: 20
status: draft
created: 2026-05-05
repo: Telegram MCP
delegation: Worker
---

# Major debounce on activity-file mtime touches

## Operator framing (2026-05-05)

> "The poke or the update of that file needs to happen with major debouncing. You can't be in the queue at the time. There should be zero activity basically for a certain amount of time before it's even valid to allow a message to come through, and any time new activity occurs from the actual session token, it just resets the timer."

## Current state

`src/tools/activity/file-state.ts:49` already has:

```ts
/** Activity-aware suppression: if agent had a tool call within this window, skip touch. */
const ACTIVITY_SUPPRESS_MS = 10_000;
```

10 seconds. Operator wants this scaled up significantly — **default to 60 seconds** (Curator's recommendation absent further direction; 60 s is the suggested floor pending operator confirmation).

## Behavior to enforce

The mtime bump is an **idle kick**, not a per-message notification. The nudge fires when ALL of:

1. There is something pending in the session queue (no point kicking if the queue is empty).
2. The session has been silent (zero session-token tool calls) for at least the debounce window.
3. The session is NOT currently inside a `dequeue` call (active long-poll = agent will see the event when dequeue returns; no kick needed).

Any session-token tool call resets the debounce timer — including the dequeue call itself, send/react/etc.

**One-nudge-per-cycle rule (operator 2026-05-05):** once a nudge fires (mtime bumped), no further nudges happen for that session until a `dequeue` call from that session is observed. Subsequent inbound messages may queue up but do NOT trigger additional bumps. The cycle re-arms when dequeue is called — even if dequeue returns empty, that's the reset signal. This prevents nudge-storms when an agent is unresponsive (rare-but-possible failure case) and keeps the wake notification meaningful.

Worst case the agent receives ONE mtime bump per idle period; multiple inbound messages during that period coalesce into the single nudge.

State machine per session:

```
state: ARMED -> NUDGE_FIRED -> ARMED (on dequeue)

ARMED + (queue not empty) + (silent for >= debounce_ms) + (no in-flight dequeue)
  → bump mtime, transition to NUDGE_FIRED

NUDGE_FIRED + (any inbound event)
  → ignore (queue accumulates; do NOT bump)

NUDGE_FIRED + (dequeue call observed)
  → transition to ARMED (whether dequeue returned events or empty)
```

## Implementation sketch

State per session:

- `lastActivityAt: number` — already exists. Updated on every session-token tool call (currently only updated on activity-file touches; needs to be updated on **every** session tool call: dequeue, send, react, action).
- `inflightDequeue: boolean` (new) — true while a dequeue call is being processed for this session.
- `nudgeArmed: boolean` (new) — true when the cycle is armed (initial state); flipped to false when an mtime bump fires; flipped back to true on the next observed dequeue call.

Touch logic (replaces the current 10s suppress):

```
on inbound event for session S:
  if (!nudgeArmed)                            → skip (already nudged this cycle)
  if (queueEmpty)                             → skip (no point)
  if (inflightDequeue)                        → skip (agent will drain via dequeue return)
  if (now - lastActivityAt < DEBOUNCE_MS)     → skip (still in suppression window)
                                                schedule timer at lastActivityAt + DEBOUNCE_MS
  else                                        → bump mtime, set nudgeArmed = false

on dequeue call (any return path) for session S:
  set nudgeArmed = true
  update lastActivityAt = now
```

Schedule a timer at `lastActivityAt + DEBOUNCE_MS` so a queued message that arrived during suppression gets a kick when the window finally elapses. Reset/clear on any new tool call.

**`DEBOUNCE_MS = 60_000` (60 seconds)** as default — operator stated twice this session. Operator also mentioned 2 minutes in passing; treat 60s as the lock-in default and add a constant comment that it can dial up to 120_000 if observed behavior wants it. Configurable per-session is out of scope for first pass.

## Acceptance criteria

- An agent actively dequeuing in long-poll receives messages through the dequeue payload; mtime is NOT bumped during the dequeue.
- An agent that has been silent for >= 60 s with pending messages receives an mtime bump.
- After an mtime bump, no further bumps until a dequeue from that session is observed (one-nudge-per-cycle rule).
- After dequeue, the cycle re-arms; another idle period with pending messages triggers another bump.
- Any session tool call (dequeue, send, react, etc.) resets the debounce window — mtime bumps stop until 60 s of silence accumulates.
- Existing 10-second suppress test is updated/replaced.
- No regression in activity-file create / delete / get behavior.

## Out of scope

- Removing `ACTIVITY_FILE_DEQUEUE_CAP_S` (that's 10-0875).
- Changes to dequeue tool itself.
- Activity file existence / cleanup behavior (unchanged).
- Per-session configurable debounce window.

## Related

- `10-0875` — remove the dequeue cap (companion change; both go together).
- Curator memory `feedback_dequeue_long_poll_primary_monitor_nudge.md`.
- `50-0868` — original activity-file feature (introduced the 10s suppress).

## Dispatch

Worker-shippable. Sonnet-class — touches state machine + timer logic + tests. Tests: 6–8 cases (debounce holds during activity, fires after silence, resets on any tool call, doesn't fire during in-flight dequeue, accumulated messages get one kick after silence).

## Bailout

Worker time-cap: 4 hours. If the `inflightDequeue` flag turns out to be hard to wire (dequeue's blocking semantics make it tricky), escalate — may need a Curator design pass.

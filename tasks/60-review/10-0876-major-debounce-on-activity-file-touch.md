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
2. The session has been **completely silent** for at least the debounce window — see "What counts as activity" below.
3. The session is NOT currently inside a `dequeue` call (active long-poll = agent will see the event when dequeue returns; no kick needed).

Any session activity resets the debounce timer.

### What counts as activity (operator 2026-05-05)

> "It can only happen if the agent hasn't been doing any animations. It can't be doing anything, right? It has to be completely inactive. No typing, no in the middle of messages, no asynchronous messaging going on. It has to be silent for 60 seconds for that timeout."

Activity is defined broadly — ANY of these resets the debounce timer:

- Any session-token tool call (`dequeue`, `send`, `react`, `action/*`, etc.).
- An active animation on the session (animation in progress, even if started earlier).
- A `show-typing` indicator currently in flight.
- An async send still rendering (e.g. TTS in progress, message_id_pending not yet resolved).
- Any in-flight tool call that hasn't returned yet (mid-multi-step turn).

The state machine treats "no detectable session-token activity from any source" as the precondition for a nudge. If TMCP can't observe a quiet session for the full debounce window, no nudge.

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

**`DEBOUNCE_MS = 60_000` (60 seconds)** as default. **Configurable per session** — operator (2026-05-05): "that timeout should be configurable, just like max_wait is. In the same way that we're able to configure max_wait, you should be able to configure max_kick or something like that."

Add a sibling action to `profile/dequeue-default`:

- `action(type: 'profile/kick-debounce', token, ms: <60_000..600_000>)` — get-or-set the per-session debounce window. Get when `ms` is omitted; set when present. Validate range (e.g. min 30s, max 10min — bail outside).

Server fallback default: `60_000`. Per-session override: stored on the session record alongside `dequeueDefault`.

Naming: `kick-debounce` is descriptive; `max-kick` (operator's suggestion) is shorter. Either works; pick the one that reads cleaner against `dequeue-default` in the action catalog. Recommend `kick-debounce` because the value IS a debounce window, not a maximum.

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

## Related

- `10-0875` — remove the dequeue cap (companion change; both go together).
- Curator memory `feedback_dequeue_long_poll_primary_monitor_nudge.md`.
- `50-0868` — original activity-file feature (introduced the 10s suppress).

## Dispatch

Worker-shippable. Sonnet-class — touches state machine + timer logic + tests. Tests: 6–8 cases (debounce holds during activity, fires after silence, resets on any tool call, doesn't fire during in-flight dequeue, accumulated messages get one kick after silence).

## Bailout

Worker time-cap: 4 hours. If the `inflightDequeue` flag turns out to be hard to wire (dequeue's blocking semantics make it tricky), escalate — may need a Curator design pass.

## Completion (partial)

- Branch: `10-0876` merged to `release/7.4`, back-merged to `dev`
- Commit: `6e1455a7` — idle-kick state machine, KICK_DEBOUNCE_DEFAULT_MS, profile/kick-debounce action
- 8 unit tests added; ACTIVITY_SUPPRESS_MS/DEBOUNCE_WINDOW_MS removed
- Worker: Worker

## Verification Stamp

**Verdict:** NEEDS_REVISION
**Date:** 2026-05-05
**Criteria:** 6/7 passed
**Evidence:** State machine, debounce timer, profile action, test coverage all correct. One-nudge-per-cycle (NUDGE_FIRED) correct. Existing suppress test replaced.
**Gap — inflightDequeue leak on early returns (dequeue.ts):**
`setDequeueActive(sid, true)` is called at line 215 of `dequeue.ts` BEFORE the `try` block. Three early-return paths exit without reaching the `finally` that calls `setDequeueActive(sid, false)`:
1. Lines 218-221 — `session_closed` return
2. Lines 285-290 — immediate batch (messages already pending)
3. Lines 293-295 — `effectiveTimeout === 0` (non-blocking dequeue)

Paths 2 and 3 are common code paths. After a fast dequeue, `inflightDequeue` is permanently stuck `true` — no further mtime kicks will ever fire for that session. Violates AC 1 (over-suppression) and AC 4 (cycle never re-arms).

**Fix:** Call `setDequeueActive(sid, false)` before each of the three early return statements, OR move `setDequeueActive(sid, true)` inside the `try` block.

## Verification Round 2 — 2026-05-06

**Verdict: APPROVED**
Verified by: Overseer (code inspection, dev branch)

Gap fix confirmed: `setDequeueActive(sid, true)` is now called at line ~140 of `dequeue.ts` AFTER the `session_closed` early-return guard. All subsequent returns are inside the `try` block — the `finally` at line ~326 unconditionally calls `setDequeueActive(sid, false)`, covering paths 1–3 from NEEDS_REVISION stamp.

Fix was implemented by task 10-0873 (runDrainLoop extraction, squash b5a23a80 on dev) and cherry-picked to release/7.4 as 6423998d.

- AC1 ✅ mtime NOT bumped during active long-poll (inflightDequeue flag works)
- AC2 ✅ 60s silent + pending → mtime bump (state machine confirmed)
- AC3 ✅ One-nudge-per-cycle (NUDGE_FIRED state)
- AC4 ✅ Cycle re-arms on dequeue (fix confirmed — no more leak)
- AC5 ✅ Any tool call resets debounce
- AC6 ✅ Existing suppress test replaced (8 unit tests added)
- AC7 ✅ No regression in activity-file create/delete/get

# telegram-mcp-dequeue-loop — uncompressed

## What this skill governs

The heartbeat loop that keeps a Telegram bridge MCP agent alive and responsive. Any agent that has joined a bridge session and is operating in conversational loop mode runs this pattern as its terminal state.

Not covered here: cold-start join (`telegram-mcp-session-startup`), recovery from compaction or forced stop (separate skills), graceful shutdown (`telegram-mcp-graceful-shutdown`).

## The invariant

**Every code path within an active session ends with a `dequeue` call.** No exceptions during normal operation. There is no "I'm done" state. The loop runs until a shutdown signal is received.

A code path that terminates without `dequeue` silently kills the session from the operator's perspective.

## Loop flow

```text
dequeue
  -> user content (text, voice, callback, reaction) -> handle -> dequeue
  -> service message (onboarding, nudge, modality hint) -> handle -> dequeue
  -> DM from peer session -> handle -> dequeue
  -> send_callback (own outbound confirmation) -> note -> dequeue
  -> empty / timed_out -> scan for work -> dequeue
  -> error -> notify appropriately -> dequeue
```

Every branch returns to `dequeue`.

## Event classes and handling

**User content:** process the message (voice is pre-saluted by the bridge — do not duplicate the salute); compose reply; send; call `dequeue`.

**Service messages:** behavior nudges (`behavior_nudge_*`), modality hints (`modality_hint_*`), onboarding messages — these are directives, not flavor. Execute them before composing replies.

**DMs from peer sessions:** handle as inbound task or status report; respond; `dequeue`.

**send_callbacks:** own outbound message confirmations — note result, `dequeue`.

## max_wait parameter

Omit `max_wait` for normal looping — the session default handles blocking. The only case to pass `max_wait: 0` is drain mode (see below).

Do not prescribe specific timeout values beyond these two cases.

## Drain pattern

When `dequeue` returns `pending > 0`, there are more messages queued. Drain before composing a reply:

```text
while pending > 0:
    dequeue(max_wait: 0)
    -> consolidate all dequeued messages
compose and send one consolidated reply
```

Never compose a reply mid-drain. Drain until `pending == 0`, then reply once to the consolidated burst.

## Server-side reactions

The bridge auto-salutes voice messages on dequeue. Agents do not duplicate this. The bridge may apply other reactions (processing preset on pending) — agents do not duplicate those either.

## Compact mode

Pass `response_format: "compact"` to save tokens per dequeue call.

In compact mode:
- `timed_out: true` is always emitted — check this first.
- `empty` is suppressed — infer empty from absence of `updates` combined with absence of `timed_out`.

## Idle behavior

No pending work does not mean exit. On timeout, scan for available work; then call `dequeue` again. No animations when idle — silence is the correct idle signal.

## Exit path

The only legitimate exit is a shutdown signal. See `telegram-mcp-graceful-shutdown` for the shutdown sequence. Re-entry after compaction: `telegram-mcp-post-compaction-recovery`.

## Don'ts

- Do not stop dequeueing for any reason other than receiving a shutdown signal.
- Do not call `session/list` or other introspection mid-loop unless a routing decision specifically requires it.
- Do not bake specific max_wait timeout values beyond "omit for default" and "`0` for drain".
- Do not use workspace-specific role names in this skill.

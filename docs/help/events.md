# Event System — POST /event

External HTTP endpoint for cross-participant signaling. Any participant — agents, hooks, scripts — POSTs an event. The bridge logs it, fans out a service message to all active sessions, and (for governor + mapped kinds) triggers an animation.

## Endpoint

POST /event

## Auth

Session token via `?token=<int>` query param **or** JSON body field `"token"`. (Token auth same as other bridge endpoints — session integer.)

## Request Body

```json
{
  "kind": "compacting",
  "actor_sid": 3,
  "details": { "run_id": "uuid-here" }
}
```

| Field | Required | Description |
| --- | --- | --- |
| `kind` | Yes | Event kind string. Must be one of the known kinds (see Event Kinds table). Unknown kinds → 400. |
| `actor_sid` | No | Integer SID of the acting session. Defaults to the token's session. |
| `details` | No | Arbitrary object. `run_id` is recommended for paired events (see Metrics). Must not contain `token`. |

## Response

`200 { "ok": true, "fanout": <count> }` — count of sessions that received the service message.

`400 { "ok": false, "error": "<reason>" }` — validation failure.

`401 { "ok": false, "error": "<reason>" }` — auth failure.

## Event Kinds

| Kind | Description | Animation | Side effect on firing session |
| --- | --- | --- | --- |
| `compacting` | Agent is compacting context | `working` | — |
| `compacted` | Compaction finished | cancel active animation (governor only) | — |
| `startup` | Agent starting up | `bounce` | — |
| `shutdown_warn` | Agent about to shut down | — | — |
| `shutdown_complete` | Agent shut down | — | — |
| `stopped` | Agent session stopped (drop-exit-resume) | — | Cancels pending debounce timer; re-arms nudge cycle; issues immediate activity-file kick |

### `stopped` — state-mutating side effect

Unlike the other kinds, `stopped` mutates state on the **firing session** itself:

1. Any pending debounce kick-timer for the session is cancelled.
2. The nudge cycle is re-armed (`nudgeArmed = true`).
3. An immediate `doTouch` is issued to the activity file, signaling the external watcher
   that the session is "available again."

The intent: the next inbound message (arriving when the resumed agent re-enters its loop)
will be picked up instantly because the file Monitor will already have fired.

If the session has no activity file registered, the response is `200 { "ok": true, "fanout": N, "hint": "no-op" }`.

**Agent-side wiring**: TBD — likely a Stop hook analogous to PreCompact. POSTing `stopped`
must be done explicitly by a hook or script for now.

## Metrics

The event log (`data/events.ndjson`) records every event. Each line:

```json
{"timestamp":"2026-04-25T14:35:22.123Z","kind":"compacting","actor_sid":3,"actor_name":"Overseer","details":{"run_id":"abc"}}
```

For paired kinds (`compacting` → `compacted`, `shutdown_warn` → `shutdown_complete`), emit **both** events with a shared `details.run_id` UUID to enable duration reporting.

## Notes

- Fan-out is fire-and-forget — the endpoint does not block on delivery.
- Tokens and secrets must not be passed in `details`.

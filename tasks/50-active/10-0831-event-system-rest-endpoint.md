---
id: 10-0831
title: TMCP event system — POST /event for cross-participant signaling, metrics, awareness
priority: 10
status: draft
type: architectural
delegation: any
---

# TMCP event system — non-MCP HTTP event endpoint

Replace the narrow `/hook/animation` pattern with a general-purpose event system. Any participant — host agents, hooks, external scripts — POSTs an event. The bridge fans out service messages, logs for metrics, and (optionally) triggers animations when the actor is the governor.

## Why

Operator quote (2026-04-25):
> "instead of that, we should have an event system, an external event system, so that the Telegram MCP can log or emit service messages to participants. For example, let's say there's an event for compacting... all participants get a service message that says hey, so-and-so is compacting right now... maintain awareness of what's going on... these types of external non-MCP events can be triggered in such a way like whether it's pre-compact, or startup or shutdown or whatever, can be more robust as a non-MCP way of doing things... the logging of events becomes part of our log. And we can get metrics from how often things like the worker, or you or the overseer are compacting."

Single endpoint covers PreCompact, startup, shutdown, and any future agent-lifecycle signal. Built-in metrics. Awareness propagates without the originating agent having to know who needs to hear.

## Endpoint sketch

`POST /event`

Auth: session token via `?token=` query OR body field `token`. Same pattern as `/hook/animation`.

Body:

```json
{
  "kind": "compacting",
  "actor_sid": <int, optional — defaults to caller>,
  "details": { ... arbitrary kind-specific fields ... }
}
```

Response: `200 { "ok": true, "fanout": <count> }` on success, `400` / `401` on auth/validation failure.

Behavior on success:
1. **Log** — append `{timestamp, kind, actor_sid, actor_name, details}` to the bridge event log (NDJSON, queryable for metrics).
2. **Fan out** — emit a service message to all active participant sessions (including governor) of the form: `{"event_type": "agent_event", "details": {"kind": "compacting", "actor": "Overseer"}}`. Sessions interpret service messages per existing protocol.
3. **Governor side-effect** (optional, kind-specific) — if `actor_sid == governor_sid` AND the kind has a registered animation mapping (e.g. `compacting → animation/compacting`), the bridge ALSO triggers the animation on the governor's session. Caller doesn't need to send a separate `/hook/animation` POST.

## Event kinds — strict taxonomy (MVP)

Only these kinds are accepted. Unknown kinds → 400 reject. **No arbitrary text payloads** — events are predefined signals, not a generic message bus. Operator (2026-04-25): "There's no custom messages... no one can come in and start spamming all the participants this way. They have to be actual predefined events."

MVP set:
- `compacting` — agent entering compaction
- `compacted` — agent finished compaction (paired with `compacting` via `details.run_id`)
- `startup` — agent started
- `shutdown_warn` — agent about to shut down
- `shutdown_complete` — agent stopped

`details` may carry kind-specific structured fields (e.g. `run_id`, `version`) but MUST NOT contain a free-form `text` / `message` field. Adding new kinds requires explicit code change to the kind allow-list.

## Service message shape

Fan-out service message format is fixed per kind. No caller-supplied prose:

```json
{ "event_type": "agent_event", "kind": "compacting", "actor": "Overseer" }
```

Recipients render their own UI from the structured fields (e.g. Curator may decide to surface "Overseer is compacting" to operator only when context-relevant).

## Relationship to `/hook/animation`

**REPLACE.** Operator (2026-04-25): "hook animation is going to be dead. We're not doing that. We're just changing to events."

`/hook/animation` is removed/deprecated. Animation is no longer separately addressable — it's a side-effect of governor-actor `compacting` events.

PR #158 includes commits wiring `attachHookRoutes` (`f7c36ddb`, `50ebea29`, `f1239967`) — those landed before this direction crystalized. Tear out in a follow-up commit on the same release branch (or fast-follow PR) so the dead surface doesn't ship as documented.

## Governor compacting animation

When `actor_sid == governor_sid` AND `kind == "compacting"`:

- Trigger a TEMPORARY high-priority `compacting` preset animation on the governor's session.
- Animation auto-vaporizes when the next outbound message from the governor arrives, OR on a fixed timeout (recommend 60s) — whichever comes first.
- Operator (2026-04-25): "a long-term temporary animation, meaning if anything comes in from the governor, it vaporizes... at very high priority level."

When `actor_sid == governor_sid` AND `kind == "compacted"`:

- Cancel the active `compacting` animation immediately (don't wait for the next outbound message or timeout).
- DO NOT emit any "back from compaction" notification. Operator (2026-04-25): "there shouldn't be any notice or notification that has to happen... telling the operator, hey, I'm back from compaction because they will have known. And then post-compaction should cancel the compacting preset." The animation disappearing IS the signal.

## help() integration

The bridge `help()` topic index should expose:
- `topic: 'events'` — list of valid event kinds + body shape + auth.
- `topic: 'event/<kind>'` — per-kind documentation.

This makes the event surface self-documenting from inside any agent session.

## Metrics

Event log is the source of agent-lifecycle metrics. Two questions the log MUST be able to answer:

- **Frequency** — how often does each agent emit each kind (e.g. `compacting` per Overseer per day).
- **Duration** — for paired-kind events (`compacting` → `compaction_complete`, `shutdown_warn` → `shutdown_complete`), how long the action took. Caller must emit BOTH start and complete events with matching `actor_sid` and a shared correlation field (e.g. `details.run_id` UUID).

Implications for the log line:
- `timestamp` must be ISO-8601 with millisecond precision.
- `actor_sid` and `actor_name` must always be populated (no anonymous events).
- For paired events, `details.run_id` is REQUIRED on both ends. Reporting joins start → complete on this id.

The reporting tool is a separate task (filed alongside) — but the log shape MUST be designed to support it now. Don't ship `/event` and discover it can't answer the questions.

Operator quote (2026-04-25): "how often does a specific agent compact? How long does the compaction take? ... we can ask you for it. Say, hey, given these metrics, where are we at right now? How can we improve?"

## Implementation notes

- Reuse `attachHookRoutes` pattern (Express). Add `/event` POST handler in a new `src/event-endpoint.ts`.
- Service-message fan-out reuses the existing service-message infrastructure used for onboarding/behavior hints.
- Event log: append to `data/events.ndjson` (or similar — match existing log conventions).
- Token validation reuses `validateSession`.
- Tests: unit (handler), integration (POST → service messages observed in receivers), governor-side-effect (POST as governor → animation trigger).

## Acceptance criteria

- `POST /event` available on bridge HTTP after `attachEventRoute(app)` is called from `index.ts`.
- Token auth via `?token=` query OR body `token` field.
- Strict kind allow-list enforced; unknown kinds → 400.
- Service-message fan-out delivers a structured event message (no caller text) to every active session.
- Governor compacting → temporary high-priority animation triggers on governor session; auto-vaporizes on next outbound message or 60s.
- Governor compacted → animation cancelled explicitly.
- Event log line appended per accepted call (NDJSON, ms timestamps, populated actor identity).
- `help(topic: 'events')` returns the event kind table.
- `/hook/animation` removed (or marked deprecated with 410 Gone) before this lands publicly.

## Don'ts

- Do NOT block the bridge on event delivery — fan-out is fire-and-forget.
- Do NOT accept unknown kinds. Strict allow-list — unknown → 400.
- Do NOT accept caller-supplied free-form text in `details`. Structured fields only.
- Do NOT include sensitive payload in `details`. Tokens, secrets must NOT pass through `/event`.
- Do NOT couple `/event` to MCP — this MUST work from a plain shell hook.

## Out of scope

- Metric dashboards / reporting tooling (separate task).
- Per-recipient filtering / subscription model (future enhancement; MVP is fan-out-to-all).
- Authentication beyond session token (no per-event signing).

## Branch

`10-0831` off `dev`.

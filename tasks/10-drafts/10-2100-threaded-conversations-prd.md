---
id: "10-2100"
title: "PRD: Threaded Conversations — multi-stream context isolation via sub-sessions"
type: prd
stage: draft
created: 2026-05-21
author: operator
---

# PRD: Threaded Conversations

## Purpose

LLMs are poor at context switching. A single Telegram session forces all inbound topics
into one agent's context, degrading focus and response quality. This feature enables the
operator to stream multiple messages on unrelated topics simultaneously — each topic is
automatically routed to an isolated sub-agent with its own context, while the host agent
remains oblivious to message content entirely.

The operator experience: messages flow naturally into coherent, focused streams. The host
is no longer a bottleneck or a context sponge.

## Scope framing

**TMCP already provides all the infrastructure this pattern requires.**
`session/spawn-child`, `session/revoke-child`, `child/forward`, `child_capability`
enforcement, dequeue, and service messages are all live in the current build.

**This spec describes the skill suite that activates the pattern** — the instruction
files, agent protocols, and routing contracts that wire the existing tools together into
a working threaded conversation system. Reply ownership tracking is already live:
`trackMessageOwner` records every outbound message's owning session, and `routeToSession`
already auto-routes inbound replies to the correct child sub-session. The one remaining
TMCP addition is a host-notification event when Path A auto-routes a reply — so the host
can perform a liveness check without being in the delivery critical path.

---

## Architecture Overview

Three layers, each with a distinct role and model tier:

```mermaid
graph TD
    OP([Telegram Operator])
    HOST["Host Agent\n(Sonnet — loop manager, liveness authority)"]
    ROUTER["Router Sub-Agent\n(fast/cheap tier — ephemeral, fresh per message)"]
    T1["Thread Sub-Agent A\n(Sonnet/Opus — pseudo-persistent)"]
    T2["Thread Sub-Agent B\n(Sonnet/Opus — pseudo-persistent)"]
    TN["Thread Sub-Agent N..."]

    OP -- "sends message" --> HOST
    HOST -- "reply to known thread\n(Path A: TMCP auto-routes)" --> T1
    HOST -- "ambiguous message\n(Path B: dispatches router)" --> ROUTER
    ROUTER -- "child/forward" --> T1
    ROUTER -- "child/forward" --> T2
    ROUTER -- "spawn-child + child/forward" --> TN
    ROUTER -- "routing report" --> HOST
    HOST -- "liveness check / kick off" --> T1
    HOST -- "liveness check / kick off" --> T2
    HOST -- "liveness check / kick off" --> TN
    T1 -- "replies via sub-session" --> OP
    T2 -- "replies via sub-session" --> OP
    TN -- "replies via sub-session" --> OP
```

---

## Components

### Host Agent

**Role:** Lifecycle manager and sub-agent orchestrator. Defends against chaotic input
by routing all ambiguous messages through the fast/cheap router. Never reads, evaluates,
or acts on message content — content-oblivion is architectural: the host has no
responsibility that would require it.

**Responsibilities:**

- Maintains the thread registry: `{ topic_label, thread_sid, agent_guid, status }`
- On each ambiguous inbound message: dispatches a router via `session/spawn-child` +
  `child/forward`, then continues its own dequeue loop
- On `thread/routed` service event (router's report via `child/notify`):
  revokes the router; reads the report; checks `status` for the reported `thread_sid`:
  - `absent` or `"inactive"`: sets `status = "spawning"`, then **out-of-band** starts
    a new sub-agent instance, passing `{ thread_sid, agent_guid, token }` as startup
    context. The router already handled sub-session creation and message queuing.
  - `"spawning"`: skip — agent is already starting; message already queued
  - `"active"` or `"idle"`: skip — message already queued
- If no `thread/routed` received within N seconds: revoke router, continue; message
  may be lost (see Known Limitations M4)
- On `thread/resolved` from a sub-agent: call `session/revoke-child`, remove registry
  entry. No content inspection — the sub-agent has already handled result delivery.
- On dequeue timeout: continue loop; optionally check for stale `"spawning"` entries

> **Division of responsibility:** the router handles all TMCP routing work —
> `session/spawn-child` for new threads, `child/forward` to queue the message.
> The host's sole post-report action is starting the background sub-agent process
> (out-of-band, not a TMCP tool) and updating the registry.
>
> The host does not consume content, synthesize results, or interact with the
> operator about thread outcomes. Those are the thread sub-agent's responsibilities.
> If a genuine reason to involve the host in content surfaces, it will be documented
> here.

### Router Agent (ephemeral, fast/cheap tier)

**Role:** Foreground sub-agent dispatched once per ambiguous inbound message. Stateless.
Currently implemented using Claude Haiku.

**Lifecycle:** host calls `session/spawn-child` + `child/forward` → router
dequeues → reads instruction file → classifies → routes (child/forward + optionally
session/spawn-child for new threads) → sends `thread/routed` report via `child/notify`
→ host revokes router.

**What the router can and cannot do:**
- **Can:** classify, `child/forward`, `session/spawn-child` (new threads), `session/revoke-child`
- **Cannot:** start the background sub-agent process (out-of-band, host's responsibility)

The router's `thread/routed` report is the complete instruction to the host. The host
takes no TMCP actions beyond receiving it, revoking the router, and starting the
background sub-agent if `status` indicates one is needed.

**Responsibilities:**

- Reads an external classify/sort instruction file (not baked into prompt — operator
  can update it without redeploying)
- Calls `dequeue` on its own sub-session token
- On timeout: returns `{ action: "timeout" }` — host handles idle cycle
- On message received:
  - Looks up thread registry (passed as context in its instructions)
  - Matches topic to existing thread SID → `child/forward` to that sub-session
  - No match → `session/spawn-child` to create new sub-session, `child/forward` message
  - **Low-confidence or ambiguous match**: routes to the **general thread** — a
    permanent catch-all sub-session always present in the registry. The router uses
    `child/forward` to the general thread's SID. The general thread sub-agent handles
    disambiguation, clarification, or triage from there. The host never receives an
    `unresolved` report for these cases — routing always completes.
  - **Multi-match**: routes to the most recent active thread. If genuinely ambiguous,
    falls through to the general thread.
  - Routing report schema: `{ action: "forwarded", message_id, thread_sid,
    topic_label?, is_new_thread? }` — delivered via `child/notify` as event type
    `thread/routed`. `topic_label` is **generated by the router** during classification
    (not by the host); included for all new-thread cases.

**Capability requirement:** `full` — must be able to call `session/spawn-child`.

**Context isolation guarantee:** The router is spawned fresh per message. It never
accumulates conversation history. Its only knowledge of threads is the registry snapshot
passed in its instructions.

### Thread Sub-Agent (pseudo-persistent)

**Role:** Background agent that owns a single conversation thread end-to-end.

**Pseudo-persistent defined:** The sub-agent is a long-running process (not re-spawned
per message). It holds its own dequeue loop continuously. Conversational context
accumulates in-model across dequeue iterations for the lifetime of the agent instance.
"Pseudo" because it is not immortal — it can crash, be revoked, or exhaust its context
window — but under normal operation it behaves as a persistent participant.

**Responsibilities:**

- Runs its own `dequeue` loop on its sub-session token
- On message received: incorporates it, continues or restarts its turn
- On timeout: if mid-work, continues; if idle, holds and loops
- Sends all operator-facing replies via its own sub-session (operator sees the named
  session as sender)
- **Closure flow** — when both closure conditions are met (actionable result exists
  AND source confirms nothing is left), the sub-agent sends a service message to the
  operator with three buttons before doing anything else:

  | Button | Style | Action |
  | --- | --- | --- |
  | Done | `danger` (red) | Full teardown — sub-agent sends `thread/resolved`, host revokes sub-session, registry entry removed |
  | Retain | default (no colour) | Graceful idle — sub-agent exits, sub-session stays open, registry entry kept with TTL (`status = "retained"`) |
  | Keep Alive | `primary` | Cancel — sub-agent continues its dequeue loop, no state change |

  **Closure conditions (both must be true before the confirmation prompt is sent):**
  1. An actionable result exists — ticket filed, task written, decision recorded, or
     equivalent artifact persisted to a known location.
  2. The source has confirmed there is nothing left:
     - **Human source:** operator confirms verbally after receiving the result summary.
     - **Agent source:** the sending agent signals completion programmatically. Agent
       DMs are self-identifying — no additional metadata needed.

- **Closure authority:** the operator has final say via the confirmation prompt. The
  host may forcibly revoke via `session/revoke-child` (e.g., resource limits) but
  this bypasses the prompt and is exceptional.
- **Autonomous escalation:** when content warrants it, the sub-agent may spawn
  grandchild sub-sessions (permitted by `full` capability) and start those processes
  out-of-band — without involving the host. The host's registry only tracks direct
  children. Grandchild lifecycle is the sub-agent's concern.
- **General thread:** a designated catch-all sub-session for unroutable or ambiguous
  messages. Always present in the registry. Does not self-terminate based on
  completion — it persists as long as the system is active.
- Model tier: Sonnet default; the sub-agent may escalate to a grandchild at Opus tier
  when complexity warrants, without notifying the host.

**Thread outcomes:** Every thread must terminate with an actionable result — a task,
spec, decision, or transcript. At minimum, the conversation is exportable for later use.
The result is written by the sub-agent directly; the host never reads or relays it.

---

## Message Routing Paths

### Path A — Reply to known thread (no router invoked)

> **TMCP auto-routing is already live.** `trackMessageOwner` records the owning session
> for every outbound bot message. `routeToSession` checks `reply_to` on each inbound
> event and delivers it directly to the owning child sub-session. The host notification
> (`thread/message_received`) is the only missing piece — added in Phase 4.

```mermaid
sequenceDiagram
    participant OP as Operator
    participant TMCP as TMCP Server
    participant HOST as Host Agent
    participant THREAD as Thread Sub-Agent X

    OP->>TMCP: reply to message (owned by sub-session X)
    TMCP->>THREAD: auto-route to sub-session X queue (routeToSession, already live)
    TMCP->>HOST: service event: thread/message_received { thread_sid: X } (Phase 4)
    HOST->>HOST: check status for thread X
    alt not active
        HOST->>THREAD: start sub-agent out-of-band { thread_sid, agent_guid, token }
    end
    THREAD->>THREAD: dequeue → handle message
    THREAD->>OP: reply via sub-session X
```

The router is never spawned. Classification is not needed.

### Path B — Ambiguous or new message (router invoked)

```mermaid
sequenceDiagram
    participant OP as Operator
    participant HOST as Host Agent
    participant ROUTER as Router (fast/cheap)
    participant THREAD as Thread Sub-Agent

    OP->>HOST: message (no reply context)
    HOST->>ROUTER: spawn-child + child/forward (registry snapshot in context)
    ROUTER->>ROUTER: dequeue message
    ROUTER->>ROUTER: classify against thread registry
    alt existing thread matched
        ROUTER->>THREAD: child/forward
    else new topic
        ROUTER->>THREAD: session/spawn-child (new sub-session)
        ROUTER->>THREAD: child/forward
    end
    ROUTER->>HOST: child/notify → thread/routed { thread_sid, topic_label, is_new_thread }
    HOST->>HOST: revoke router
    HOST->>HOST: check status for thread_sid
    alt status absent or inactive
        HOST->>THREAD: start sub-agent out-of-band { thread_sid, agent_guid, token }
    end
    THREAD->>THREAD: dequeue → handle message
    THREAD->>OP: reply via sub-session
```

---

## TMCP Facilitation (existing)

All tools required by this pattern are already implemented:

| Tool | Role in this pattern |
| --- | --- |
| `session/spawn-child` | Router creates new thread sub-sessions |
| `session/revoke-child` | Host tears down completed threads |
| `child/forward` | Router injects classified messages into thread queues |
| `child_capability` | Router runs `full`; thread agents run `full` |
| `dequeue` | Router dequeues one message per dispatch; thread agents hold their own loop |
| Service messages | `thread/message_received` delivered to host queue via existing mechanism |
| `trackMessageOwner` + `routeToSession` | Reply auto-routing to child sub-sessions — **already live** |
| `child/notify` *(untracked TMCP prerequisite)* | Child sends structured message to parent queue. Used for: routing reports (`thread/routed`), completion signals (`thread/resolved`). No current TMCP tool exposes child→parent messaging — this must be added before Phase 1. |

### `child/forward` — forwarding mechanism (OQ7 resolved)

`child/forward` must forward the original `TimelineEvent` (full Telegram message metadata
including `message_id`, attachments, voice source) rather than a stripped text string.
The implementation change: accept a `message_id` parameter, look up the full event,
and re-enqueue it to the target sub-session via `enqueueToSession` — the same mechanism
`routeToSession` already uses. The text-only `deliverServiceMessage` path is replaced.

This is a prerequisite for Phase 1 (thread sub-agents must be able to reply-to and access
attachments from forwarded messages).

### Remaining TMCP addition (Phase 4 prerequisite)

When `routeToSession` auto-routes a reply to a child sub-session, inject a service event
into the parent session's queue: `{ type: "thread/message_received", thread_sid: X }`.
This gives the host a liveness signal without being in the delivery critical path.
Reply delivery to the thread itself is already handled server-side.

---

## Thread Registry

Maintained by the host agent in its own context. Serialized and passed to the router
as part of its instruction context on each dispatch.

Schema (per thread):

```text
{
  thread_sid:      number,    // sub-session SID (TMCP child session)
  agent_guid:      string,    // UUID generated by host at spawn time; stable for the
                              // lifetime of the sub-agent instance; used as the handle
                              // to identify and kick off the correct background agent
  topic_label:     string,    // human-readable topic name (set at spawn, immutable)
  status:          "spawning" | "active" | "idle" | "retained",
                              // spawning  = sub-session created, agent start triggered
                              //   but not yet confirmed (prevents double-kick-off race)
                              // active    = sub-agent confirmed running (dequeue loop
                              //   live or mid-work)
                              // idle      = dequeue timeout; still alive, holds queue
                              // retained  = operator chose "Retain"; sub-agent exited
                              //   but sub-session stays open; eligible for revival
                              //   until retained_until expires
  retained_until:  iso8601 | null,
                              // set when status becomes "retained"; null otherwise
                              // after expiry, host revokes sub-session and removes entry
  created_at:      iso8601,
  last_message:    iso8601
}
```

`agent_guid` is assigned by the host at `session/spawn-child` time (e.g., `crypto.randomUUID()`).
It is passed to the background sub-agent as its identity so the host can target the
correct agent instance if a restart is needed. It is not a TMCP concept — it is
host-layer bookkeeping only.

The host updates `status` when it spawns a router (set to `"spawning"`), when it
receives the sub-agent's first signal (set to `"active"`), on dequeue timeout signals
(set to `"idle"`), on operator "Retain" choice (set to `"retained"`, `retained_until`
set to now + TTL), and on `thread/resolved` (entry removed from registry). On startup
reconciliation, any `"retained"` entry whose `retained_until` has passed is treated as
expired: the host revokes the sub-session and removes the entry.

Writes to `data/thread-registry.json` **must use atomic temp-file-plus-rename
semantics** and include a `schema_version` field. The file is validated against the
schema on every read. On startup/resume, the host reconciles the persisted registry
against TMCP's live child session list: any entry whose `thread_sid` has no matching
live TMCP child session is treated as crashed (see M3) and flagged for operator review.

```mermaid
stateDiagram-v2
    [*] --> Spawning : host calls session/spawn-child\n+ sets status="spawning"
    Spawning --> Active : sub-agent sends first signal\nor receives first message
    Active --> Working : message received
    Working --> Active : turn complete, reply sent
    Active --> Idle : dequeue timeout, no pending work
    Idle --> Active : new message arrives (child/forward or auto-route)
    Active --> ClosurePrompt : closure conditions met
    Idle --> ClosurePrompt : closure conditions met
    Working --> ClosurePrompt : closure conditions met mid-turn
    ClosurePrompt --> Resolved : operator chooses Done
    ClosurePrompt --> Retained : operator chooses Retain
    ClosurePrompt --> Active : operator chooses Keep Alive
    Retained --> Active : new message arrives\nhost kicks off fresh agent
    Retained --> [*] : TTL expires\nhost revokes sub-session
    Resolved --> [*] : host calls session/revoke-child
```

---

## Capability Requirements

| Agent | Capability | Rationale |
| --- | --- | --- |
| Router (fast/cheap tier) | `full` | Must call `session/spawn-child` for new threads |
| Thread sub-agent | `full` | Full domain access; no artificial restrictions |
| Alternative: add `router` capability tier | blocks destructive actions | Future hardening; out of scope now |

---

## Known Limitations

These are acknowledged risks accepted for this version of the spec. Each may be
addressed in a future iteration.

**M3 — Stale `status` on sub-agent crash.** If a thread sub-agent dies without
sending a `thread/resolved` signal, its registry entry stays at `status = "active"`
or `"idle"`. Messages forwarded to that sub-session queue are silently undelivered
until the host detects the stale state on startup reconciliation or by timeout. No
dead-letter or re-queue mechanism exists.

**M4 — Orphaned sub-session on router crash.** If the router successfully calls
`session/spawn-child` but crashes before returning the routing report, a sub-session
exists in TMCP's child-registry with no entry in the host's thread registry. The host
cannot manage or revoke it. Manual cleanup required.

**M8 — Thread resolution race.** A sub-agent may send `thread/resolved` and then be
revoked while a reply is in-flight. If the reply arrives after revocation, it is
dropped. No drain protocol or closing state exists. Acceptable for v1 given graceful
closure is operator-initiated and operator-paced, but must be addressed before
high-frequency use.

**M9 — `message_id` lookup failure in `child/forward`.** The updated `child/forward`
looks up the full `TimelineEvent` by `message_id`. If the event is not in the store
(retention cutoff, race, or attachment cleanup), the forward silently fails or
degrades. Failure path is unspecified. The host and router have no negative-ack path.

**M10 — Service event sender not validated.** The host trusts `thread/routed` and
`thread/resolved` events by event type alone. A `full`-capability sub-agent could send
`{ type: "thread/resolved", thread_sid: Y }` where Y is not its own thread, falsely
closing another thread. The host **must** validate that the sender SID matches the
`thread_sid` in the registry before acting on any control-plane service event.

**M7 — Content-oblivion is architectural by design.** The host has no responsibility
that requires reading message content. Routing decisions are delegated to the router;
result delivery is delegated to thread sub-agents. No capability fence is needed
because no use case exists for the host to consume content. The boundary holds as long
as the host's role is not expanded.

---

## Minimum Viable Configuration (Unskilled Governor)

The full pattern requires a routing skill (OQ1). However, the host agent can operate
without one — this is the onboarding path and a supported degraded mode.

**Without a skill file:**
- No router is ever spawned. Auto-classification is disabled.
- The operator drives thread creation explicitly (e.g. "start a thread on X").
- The host creates a sub-session via `session/spawn-child`, starts the sub-agent
  out-of-band, and adds it to the registry.
- Path A (reply auto-routing) works as normal — TMCP routes replies to the correct
  sub-session regardless of how it was created.
- The closure flow (Done / Retain / Keep Alive) works as normal.

This mode is fully functional for manual workflows. Add the routing skill later to
enable automatic Path B classification without changing any other part of the system.

---

## Out of Scope

- Forum topic / `message_thread_id` binding (iceboxed, 10-1952-T3)
- Alternative configurations (single-agent, synchronous dispatch, no-router variants)
- Claude Code plugin packaging of host/router skills (tracked separately, 00-0001)
- Sub-agent tier selection logic beyond "Sonnet default, Opus if needed"
- Thread export format and delivery mechanism (downstream concern)

---

## Open Questions

| # | Question | Decider | Decision |
| --- | --- | --- | --- |
| OQ1 | Where does the classify/sort instruction file live? (`skills/`, `data/`, operator-editable path?) | Operator | Open |
| OQ2 | How does the host detect sub-agent termination? | Spec | **Closed.** Liveness is binary: sub-agent is either (a) in an active dequeue call, or (b) host has dispatched a task and not yet received `thread/resolved`. No heartbeat or ping needed. Host sets `status = "spawning"` when it kicks off; sub-agent signals via `thread/resolved` (via `child/notify`) before closing. Stale `status` on crash is Known Limitation M3. |
| OQ3 | Should the `thread/message_received` host-notification event be always-on or opt-in? | Operator | Open — recommended always-on when session has `parent_sid` set. |
| OQ4 | What is the thread sub-agent's yield/completion signal back to the host? | Spec | Defined — `thread/resolved` service message. See Thread Sub-Agent section. |
| OQ5 | Should the router capability be reduced from `full` to a new `router` tier? | Operator | Open |
| OQ6 | Should the thread registry be persisted to survive host context compaction? | Operator | **Closed.** Yes — host skill writes registry to `data/thread-registry.json` after every mutation (new thread, is_active change, removal). Reads on startup/resume. TMCP already writes traffic to NDJSON; conversation state is memory-only, so the host skill owns persistence. |
| OQ7 | Should `child/forward` carry full Telegram message metadata? | Spec/TMCP | **Closed.** Yes — `child/forward` re-enqueues the original `TimelineEvent` (looked up by `message_id`) via `enqueueToSession`, the same mechanism `routeToSession` uses. Text-only `deliverServiceMessage` path is replaced. This is a Phase 1 prerequisite. |
| OQ8 | What is the maximum number of concurrent thread sub-sessions? | Operator | Open |
| OQ-A | Thread revival: when a topic revisits a thread after TTL expiry (sub-session closed), does the router spawn a fresh sub-session or inject historical context? | Spec/Operator | **Partially closed.** Within the TTL window (`status = "retained"`), the sub-session is still open — router routes to the same SID, host kicks off a fresh agent, context is naturally available. After TTL expiry the sub-session is revoked. Full revival from a fully closed thread remains open. |
| OQ-B | Human confirmation UX: how does the operator signal to a thread sub-agent that the thread is done? | Operator | **Closed.** Sub-agent sends a service message with three operator buttons: **Done** (red — full teardown), **Retain** (default — sub-agent exits, sub-session stays open with TTL), **Keep Alive** (primary — cancel, sub-agent continues). Operator presses a button; no free-text required. |

---

## Implementation Phases

### Phase 1 — Router skill (fast/cheap tier)

**OQ gate:** OQ1 (classification file location) must be closed before this phase.

**TMCP prerequisites (must land first):**
1. Extend `child/forward` to re-enqueue full `TimelineEvent` by `message_id` via
   `enqueueToSession` (replacing text-only path).
2. Add `child/notify` tool: child session delivers a structured message to its parent
   queue. Used for routing reports (`thread/routed`) and `thread/resolved` signals.

Write the classify/sort instruction file. Define the routing report schema
(`thread/routed` event). Define thread registry serialization format for router context.
Test with a single static thread.

**Path A in Phases 1–3 (degraded):** TMCP auto-routes replies to thread sub-sessions
correctly, but the host-notification event (`thread/message_received`) is Phase 4. The
host has no liveness signal for Path A until then. Acceptable degradation: thread
sub-agents are long-lived and hold their own dequeue loop — they process auto-routed
replies without host intervention. Dead-thread recovery on Path A is unavailable until
Phase 4.

### Phase 2 — Host loop skill

**OQ gate:** OQ8 (session cap) should be closed before this phase.
**Phase 1 must be complete** (TMCP prerequisites landed, router skill tested).

Write the host loop instructions. Define liveness check and sub-agent kick-off pattern.
Define thread registry update protocol (on new thread, on agent start/stop).
Persist registry to `data/thread-registry.json` on every mutation.
Test multi-thread routing.

### Phase 3 — Thread sub-agent skill

**Phase 2 must be complete.**

Write the thread sub-agent loop instructions. Implement `thread/resolved` via
`child/notify` per spec (signal already defined — see Thread Sub-Agent section).
Define result export pattern (task, spec, transcript).

### Phase 4 — TMCP host notification for Path A

When `routeToSession` auto-delivers an inbound reply to a child sub-session, inject a
service event into the parent session's queue:
`{ type: "thread/message_received", thread_sid: X }`.
This gives the host a liveness signal without intercepting the delivery path.
The reply is already in the thread queue by the time the host reads the notification.
Opt-in vs always-on decision deferred to OQ3.

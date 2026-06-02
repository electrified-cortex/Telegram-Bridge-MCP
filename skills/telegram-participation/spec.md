# Skill Spec: telegram-participation

## Purpose

Bootstrap any TMCP-enabled agent from zero to operational Telegram participant. One skill — gets the agent connected and the loop running. For everything else, use `help()`.

## Scope

**Covered:** Connection check, session anchor (fresh start and reconnect), startup drain, post-connect setup delegation, and dequeue loop entry.

**Not covered:** Monitor arm/verify, graceful shutdown — delegated to bridge `help()` topics. Profile load is covered explicitly in R4 Step 1 (not delegated).

## Definitions

**post_compact_monitor_recovery** — service message queued after compaction (`event_type: "post_compact_monitor_recovery"`). Signals that the prior session registration survives on the server; triggers `help('compacted')` to handle monitor recovery.

## Lifecycle Flow

```mermaid
flowchart TD
    START([Agent Starts]) --> R1A

    subgraph R1["R1 — Connection Check"]
        R1A{TMCP reachable?}
    end
    R1A -->|No| STOP1([Notify operator — stop])
    R1A -->|Yes| R2A

    subgraph R2["R2 — Session Anchor"]
        R2A{Token present?}
        R2B["reminder/list probe"]
        R2C{Result?}
        R2D["session/start (fresh)"]
        R2E["session/reconnect (dead token)"]
        R2F{Approved?}
    end
    R2A -->|Yes| R2B
    R2A -->|No| R2D
    R2B --> R2C
    R2C -->|Success| R3A
    R2C -->|AUTH_FAILED| R2E
    R2C -->|Other error| STOP2([Notify operator — stop])
    R2D & R2E --> R2F
    R2F -->|Yes — new token| R3A
    R2F -->|No / Timeout| STOP3([Notify operator — stop])

    subgraph R3["R3 — Startup Drain"]
        R3A["dequeue(max_wait: 0)"]
        R3B{POST_COMPACT_MONITOR\n_RECOVERY in batch?}
        R3C["help('compacted')"]
    end
    R3A --> R3B
    R3B -->|Yes| R3C
    R3B -->|No| R4A
    R3C --> R4A

    subgraph R4["R4 — Post-Connect Setup"]
        R4A["profile/load (own key)"]
        R4B["send animation (working, 60s)"]
        R4C["help('startup')"]
    end
    R4A --> R4B --> R4C --> R5A

    subgraph R5["R5 — Dequeue Loop"]
        R5A["dequeue (session default)"]
        R5B[Process messages]
        R5C{Shutdown\ndirective?}
    end
    R5A --> R5B
    R5B --> R5C
    R5C -->|No| R5A
    R5C -->|Yes| R6A

    subgraph R6["R6 — Closeout"]
        R6A["help('shutdown')"]
    end
    R6A --> END([Session closed])

    style R1 fill:#1a3a5c,stroke:#4a9eff,color:#fff
    style R2 fill:#1a3a5c,stroke:#4a9eff,color:#fff
    style R3 fill:#1a3a5c,stroke:#4a9eff,color:#fff
    style R4 fill:#1a4a2c,stroke:#4aff9e,color:#fff
    style R5 fill:#3a2a1c,stroke:#ffaa4a,color:#fff
    style R6 fill:#3a1a1c,stroke:#ff4a4a,color:#fff
```

## Requirements

### R1 — Connection check

| Condition | Action |
| --- | --- |
| TMCP unreachable | Notify operator; report unavailable; stop |
| TMCP reachable | Proceed to R2 |

### R2 — Session anchor

**Token absent (fresh start):** `action(type: 'session/start', name: '<AgentName>')` — operator approval dialog (blocking, up to 120s). On approval: store new token, proceed to R3. Denied or timed out: notify operator; report unavailable; stop.

**Token present:** Probe: `action(type: 'reminder/list', token: <token>)`.

| Result | Action |
| --- | --- |
| Success | Session live — proceed to R3 |
| `AUTH_FAILED` or invalid token | `action(type: 'session/reconnect', name: '<AgentName>')` — same approval dialog; store new token; proceed to R3. Denied/timeout: notify; stop. |
| Unexpected error | Notify operator; stop |

### R3 — Startup drain

Single call: `dequeue(max_wait: 0)`. Do not loop. If a `post_compact_monitor_recovery` event is in the batch, call `help('compacted')` before proceeding to R4.

### R4 — Post-connect setup

1. **Profile load (first):** `action(type: 'profile/load', key: '<agent-name>')`. Use the pod's own identifier (e.g. `bt`, `curator`, `zhuli`, `overseer`). MUST use the agent's own key — never another session's key. Idempotent; safe after compaction. Ensures voice, animation, and reminder settings are loaded before any further setup.
2. **Boot animation:** `send(type: 'animation', preset: 'working', timeout: 60, token)`. Fires the earliest visible presence signal — operator sees activity within seconds of session anchor instead of waiting through silent setup. 60s temporary; auto-clears or is superseded by the first real send. MUST fire after Step 1 (profile/load provides the session's voice/animation settings).
3. **Setup delegation:** `help('startup')` — activity monitor arm and dequeue defaults. Profile load is now handled in Step 1.

All three MUST run after R2 (and after R3's compaction-recovery branch if taken). Steps MUST execute in order: 1 → 2 → 3.

### R5 — Dequeue loop

`dequeue(token)` with no explicit `max_wait` — session default applies. End every turn with dequeue. Do not override session default via `profile/dequeue-default`. Drain polls (`max_wait: 0`) are permitted.

### R6 — Closeout

Before any shutdown path: drain the queue with `dequeue(max_wait: 0)`, then `action(type: 'session/close', token)`. On `LAST_SESSION` error: retry with `force: true`.

## Help Breadcrumbs

| Topic | What it covers |
| --- | --- |
| `help('index')` | Full topic menu |
| `help('startup')` | Monitor arm, dequeue defaults (profile/load explicit in R4 Step 1) |
| `help('compacted')` | Post-compaction monitor recovery |
| `help('guide')` | Communication patterns, etiquette, presence, animations |
| `help('dequeue')` | Dequeue loop rules, drain vs. block |
| `help('activity/file')` | Activity file and monitor scripts in depth |

## Constraints

- Do not call `help('startup')` before R2 completes.
- Do not call `profile/load` with another agent's key — always use the pod's own identifier.
- R3 drain is a single call; do not loop it.
- Do not override session dequeue default via `profile/dequeue-default`.
- Every shutdown path must invoke `help('shutdown')`.

## Acceptance Criteria

- [ ] Fresh start (no token): R1–R5 execute; operator approval fires; dequeue loop entered.
- [ ] Stale token: `AUTH_FAILED` → `session/reconnect` fires; new token stored; proceeds from R3.
- [ ] No token, denied: stop after failed approval; no further bridge calls.
- [ ] TMCP unreachable: notify operator; stop before any bridge calls.
- [ ] Compaction: `POST_COMPACT_MONITOR_RECOVERY` detected in R3 drain; `help('compacted')` called before R4.
- [ ] `profile/load` called with the pod's own key as first step of R4, after every successful session anchor.
- [ ] Boot animation (`send(type:'animation', preset:'working', timeout:60)`) fires after `profile/load` and before `help('startup')`.
- [ ] `help('startup')` called after `profile/load` and boot animation.
- [ ] Every turn ends with dequeue.
- [ ] `help('shutdown')` called on all shutdown paths.

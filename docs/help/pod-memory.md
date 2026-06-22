# pod-memory — Compaction-Survivable Agent State Convention

## Token storage path

```
memory/telegram/session.token
```

Plain integer. No JSON wrapper. No quotes. Write the raw token number and nothing else.

**Save immediately after `session/start` or `session/reconnect` returns your token.**

## Rationale

Your agent runtime's context compaction erases in-memory state. Any value you need after a compaction must be written to a file before the compaction occurs. The `memory/` directory is the canonical location for persistent state — it sits outside the context window and survives compaction unconditionally.

## Relative paths

All paths in this convention are relative to your agent's working directory (the root directory your agent runs from), not to the repository root.

## Rule

Everything TMCP wants the agent to retain across compaction must live under `memory/` with a documented sub-path. Current documented sub-paths:

| Sub-path | Content | Format |
| --- | --- | --- |
| `memory/telegram/session.token` | Active TMCP session token | Plain integer (no JSON) |

## Recovery after compaction

1. Read `memory/telegram/session.token` to retrieve your saved token.
2. Call `dequeue(token: <saved_token>, max_wait: 0)` to confirm the bridge link is alive.
3. If dequeue returns `session_closed` or the file is empty/missing, call `action(type: 'session/reconnect', name: '<your_name>')`.

See `help('compacted')` for the full post-compaction recovery sequence.

## Wipe on shutdown

Before calling `session/close` or `shutdown`, overwrite the token file with empty content:

```
Write "" to memory/telegram/session.token
```

This prevents a stale token from causing a spurious resume on the next agent launch.

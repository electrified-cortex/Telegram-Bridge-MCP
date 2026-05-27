# telegram-mcp-session-startup — uncompressed

## What this skill governs

The cold-start procedure for an agent joining the Telegram bridge MCP chat from scratch. Cold-start is the path when no prior session exists for this agent identity (no token in memory). Distinct from compaction recovery and forced-stop recovery.

Applies when: session memory file is empty or absent, no checkpoint or handoff indicates a prior session worth recovering, host runtime is fresh (or prior recovery logic determined cold-start is appropriate).

Not covered: post-compaction recovery (`telegram-mcp-post-compaction-recovery`), forced-stop recovery (`telegram-mcp-forced-stop-recovery`).

## Step 0: Silent probe FIRST (disambiguation)

Before calling `session/start`, check the session memory file for a token. If a token exists, attempt a silent probe:

```text
dequeue(max_wait: 0, token: <token from memory>)
```

- Probe succeeds (any non-error response) -> session is alive. Fall through to `telegram-mcp-post-compaction-recovery` instead of continuing here.
- Probe errors (session not found) -> session is dead. Continue with cold-start.
- Memory file empty / absent -> no prior session. Continue with cold-start.

Do NOT skip Step 0. The silent probe is the only way to avoid a false reconnect prompt to the operator.

## Cold-start sequence

### Step 1: Learn the API

```text
help()
help(topic: 'guide')
```

Mandatory — API may have changed since last session. Call `help('action')` for the dispatcher reference.

### Step 2: Join chat

```text
action(type: "session/start", name: "<AgentName>")
```

Returns `{ token, sid, pin, sessions_active, action, pending }`.

Token formula: `token = sid * 1_000_000 + pin`. The token is your identity for all subsequent calls.

Session name constraints (INVALID_NAME on violation):
- Allowed: letters (A-Z, a-z), digits (0-9), spaces.
- Regex: `^[a-zA-Z0-9 ]+$`
- Rejected: hyphens, underscores, emoji, non-Latin Unicode, empty/whitespace-only, collision with existing session (case-insensitive).

For non-governor sessions: the bridge triggers an operator approval dialog before the session becomes fully active. Wait for approval.

### Step 3: Save token immediately

Write to session memory file:
```text
Token: <token>
SID: <sid>
Name: <AgentName>
Started: <ISO 8601 timestamp>
```

Do this immediately after `session/start` returns — before any other calls.

### Step 4: Load profile

```text
action(type: "profile/load", key: "<ProfileKey>")
```

Restores voice, animation presets, reminders. Profile must be loaded AFTER `session/start` — it binds to the current session.

If no profile exists: import from `profiles/<ProfileKey>.json`, then save.

### Step 5: Enter the dequeue loop

```text
dequeue
```

See `telegram-mcp-dequeue-loop`.

## Session name reference

| Name | Valid? |
| --- | --- |
| `Worker 1` | Yes |
| `Specialist Agent` | Yes |
| `Worker-1` | No (hyphen) |
| `Worker_1` | No (underscore) |
| `Agent123` | Yes |

## Cross-references

- Loop: `telegram-mcp-dequeue-loop`.
- Compaction recovery (Step 0 fallback): `telegram-mcp-post-compaction-recovery`.
- Action dispatcher: `help('action')`.

## Don'ts

- Do not skip Step 0. Always probe before starting fresh.
- Do not call `profile/load` before `session/start`. Order matters.
- Do not bake host-specific name selection logic here.
- Do not include workspace agent role names.

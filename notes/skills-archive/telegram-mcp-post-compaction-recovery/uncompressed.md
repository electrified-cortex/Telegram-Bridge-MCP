# telegram-mcp-post-compaction-recovery — uncompressed

## What this skill governs

The recovery procedure an agent runs after its host runtime compacts the conversation. Compaction truncates in-memory turn history but does NOT kill the Telegram session — the bridge token is still valid and the dequeue loop should resume seamlessly.

Not covered: forced-stop recovery (`telegram-mcp-forced-stop-recovery`), stop hook handling (`telegram-mcp-stop-hook-recovery`), cold-start session join (`telegram-mcp-session-startup`).

## Critical rule

Do NOT call `action(type: "session/start")` or `action(type: "profile/load")` unless the silent probe confirms the session is dead.

- `session/start` with `reconnect: true` sends the operator a reconnect prompt — unnecessary noise when the session is alive.
- `profile/load` overwrites preserved session settings (voice, animations, reminders) — destructive when the session is alive.

Earlier versions used animation-based liveness checks. The canonical mechanism is now the silent probe via `dequeue(max_wait: 0)`.

## Recovery procedure (ordered)

### Step 0: Read session memory file

The file contains a plain integer token. No frontmatter, no checkpoint blocks.

| File state | Action |
| --- | --- |
| Empty or missing | No active session — skip to Step 3 |
| Contains valid integer | Token found — proceed to Step 1 |

If the token is absent and no clean close was recorded, check `telegram-mcp-forced-stop-recovery` to determine if this is a forced-stop scenario before proceeding.

### Step 1: Silent probe

```text
dequeue(max_wait: 0, token: <your_token>)
```

- Normal response (empty, timed_out, or updates) -> session alive. Drain returned updates if any, then skip to Step 5.
- Error indicating session not found / closed -> session dead. Proceed to Step 3.

### Step 2: (skipped if session alive)

### Step 3: Reconnect (only if session dead)

```text
action(type: "session/reconnect", name: "<AgentName>")
```

Save the new token to the session memory file.

### Step 4: Reload profile (only after reconnect — old session state is gone)

```text
action(type: "profile/load", key: "<ProfileKey>")
```

Do NOT call this if the session was alive.

### Step 5: Check missed messages

If Step 1 returned `{ empty: true }`, retrieve context that arrived during the compaction gap. Scan for messages that arrived while compacted.

Before responding to any history messages: check whether your SID already has a recent outbound reply to that message ID. If yes, skip — already responded before compaction.

### Step 6: Drain pending and re-enter loop

```text
dequeue(max_wait: 0)
```

Then resume normal dequeue calls (`telegram-mcp-dequeue-loop`).

## Why this matters

Compaction happens automatically at context limit — mid-conversation, mid-task, or idle. The goal is to recover without:
- Sending the operator an unnecessary reconnect prompt.
- Losing voice / animation settings via redundant `profile/load`.
- Double-responding to already-handled messages.
- Silently dying without credentials.

## Cross-references

- Forced-stop distinction: `telegram-mcp-forced-stop-recovery`.
- Loop re-entry: `telegram-mcp-dequeue-loop`.
- Cold-start fallback: `telegram-mcp-session-startup`.

## Don'ts

- Do not ask the operator for a status check. Recovery should be silent unless the session is genuinely dead.
- Do not call `profile/load` when the session is alive — it is destructive, not corrective.
- Do not bake workspace-specific memory file paths into this skill. Use "session memory file" abstractly.

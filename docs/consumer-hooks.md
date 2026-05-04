# Consumer Hooks Setup Guide

This guide covers two hook patterns used by the in-house agent fleet when integrating with Telegram MCP. Both hooks are registered in `.claude/settings.local.json` and fire automatically during the Claude Code session lifecycle.

---

## Loop Guard

### Problem

When an agent calls `dequeue()` and waits for an incoming message, Claude Code sits idle. If the IDE or host times out the conversation during this wait, it kills the session — dropping any pending Telegram messages and leaving peers with no response.

### How It Works

The loop guard is a `Stop` hook that intercepts Claude Code's attempt to end the conversation and checks whether an active Telegram session exists.

**Decision logic:**

1. Reads the path from the `TELEGRAM_SESSION_FILE` environment variable
2. If the file exists and is non-empty, and `stop_hook_active` is not `true` in the hook input JSON: outputs `{"decision": "block", "reason": "..."}` — the stop is blocked and Claude is prompted to call `dequeue` instead
3. If `stop_hook_active == true` (the "are you sure?" re-prompt from Claude Code): exits 0 and allows shutdown — this prevents infinite blocking loops
4. If the file is missing or empty (session closed or not started): exits 0 — normal shutdown proceeds

**Timeout:** 10 seconds

### Reference Implementations

- PowerShell: `.agents/hooks/telegram-loop-guard.ps1` (consumer-agents repo)
- Bash: `.claude/hooks/telegram-loop-guard.sh` (this repo)

### Settings Registration

Add to `.claude/settings.local.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "shell": "powershell",
            "type": "command",
            "command": "& \"$env:CLAUDE_PROJECT_DIR/../../hooks/telegram-loop-guard.ps1\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### Required Environment Variable

| Variable | Description |
|---|---|
| `TELEGRAM_SESSION_FILE` | Absolute path to the session token file. Content must be a plain-text integer (the token returned by `action(type: 'session/start')`). An empty file or absent file signals no active session — normal shutdown is allowed. |

### Failure Mode Without This Hook

Claude Code or the VS Code IDE can time out the conversation when the agent is blocking on `dequeue()`. The agent appears stuck, the session is killed, and any pending messages in the queue are lost.

---

## Compaction Notifications

### Problem

When Claude Code compacts the conversation context to save tokens, the agent loses its full history. Peers and the operator need to know this happened so they can account for reduced context when routing work or interpreting responses.

### How It Works

Two hooks fire around the compaction lifecycle:

- `PreCompact` — fires before context is discarded; emits a `compacting` event
- `PostCompact` — fires after context is restored; emits a `compacted` event

Both events carry the same `run_id` UUID, which lets consumers pair them for duration tracking.

**Reference implementation:** `.agents/hooks/telegram-event.ps1 -Kind compacting` / `-Kind compacted` (consumer-agents repo)

### Event API

Both hooks `POST` to `{TELEGRAM_BRIDGE_HTTP_BASE}/event?token={token}`.

Example `PreCompact` payload:

```json
{
  "kind": "compacting",
  "token": 1234567,
  "details": {
    "run_id": "uuid-pairs-compacting-with-compacted",
    "timestamp": "2026-05-04T12:00:00.000Z"
  }
}
```

The `run_id` is generated once at `compacting` time and reused in the `compacted` payload. The `PostCompact` payload is identical except `"kind": "compacted"`.

### What Peers See

When another agent calls `dequeue`, compaction events appear as service messages:

```json
{
  "event": "service_message",
  "content": {
    "type": "service",
    "event_type": "agent_event",
    "text": "AgentName is compacting context (run_id: ...)"
  }
}
```

### Settings Registration

Add to `.claude/settings.local.json`:

```json
{
  "hooks": {
    "PreCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "shell": "powershell",
            "type": "command",
            "command": "& \"$env:CLAUDE_PROJECT_DIR/../../hooks/telegram-event.ps1\" -Kind compacting",
            "timeout": 5
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "shell": "powershell",
            "type": "command",
            "command": "& \"$env:CLAUDE_PROJECT_DIR/../../hooks/telegram-event.ps1\" -Kind compacted",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

### Required Environment Variables

| Variable | Description |
|---|---|
| `TELEGRAM_SESSION_FILE` | Same as the loop guard — path to the session token file. |
| `TELEGRAM_BRIDGE_HTTP_BASE` | Base URL of the Telegram bridge. Optional; defaults to `http://127.0.0.1:3099`. |

### Behavior on Error

Both hooks always exit 0 — they never block the host. HTTP timeouts or bridge connectivity failures are silent.

### Failure Mode Without These Hooks

The operator and peers receive no signal when an agent loses context. Work may be re-routed unnecessarily, or the agent may be assumed to have full history when it does not.

---

## Setup Checklist

Follow these steps when configuring a fresh project:

1. **Copy hook scripts** from the reference location in the consumer-agents repo, or write your own that match the interface described above.

2. **Register hooks** — add the `Stop`, `PreCompact`, and `PostCompact` entries to `.claude/settings.local.json` as shown in each section above. Combine all hooks under a single top-level `"hooks"` key.

3. **Wire environment variables** — set `TELEGRAM_SESSION_FILE` to the absolute path of your session token file. The conventional location is `{CLAUDE_MEMORY_DIR}/telegram/session.token`. Set `TELEGRAM_BRIDGE_HTTP_BASE` if your bridge runs on a non-default port.

4. **Start a session** — call `action(type: 'session/start')` and write the returned integer token to `TELEGRAM_SESSION_FILE`.

5. **Smoke test the loop guard** — with a token present in `TELEGRAM_SESSION_FILE`, attempt to stop Claude Code. The Stop hook should block and Claude should be prompted to call `dequeue` instead of exiting.

6. **Smoke test compaction notifications** — trigger a compaction (or simulate one) and watch for `agent_event` service messages in another session's `dequeue` output. Confirm both `compacting` and `compacted` events appear with matching `run_id` values.

### Common Pitfalls

**PowerShell version** — the reference scripts require PS7+ (`pwsh`). The built-in Windows PS5.1 (`powershell.exe`) will fail silently on some constructs. Install PowerShell 7 separately if it is not already present.

**Hook permission scope** — `.claude/settings.local.json` is user-scoped and does not require explicit hook permission grants. If you use `settings.json` (project-scoped) instead, hook permissions must be explicitly allowed. Prefer `settings.local.json` for hook registrations.

**Stale session token** — the token in `TELEGRAM_SESSION_FILE` must be updated on every `session/start` call. A stale token causes compaction events to fail silently with a 401 response from the bridge.

**Empty file is not the same as no file** — the loop guard reads the file and checks that it is non-empty. An empty file is treated as "session closed" and allows normal shutdown. Do not leave a zero-byte file in place if you intend the guard to be active.

---

## See Also

- `docs/help/stop-hook.md` — detailed reference for the Stop hook lifecycle and block/allow decision flow
- `docs/help/events.md` — full event API reference including all `kind` values, payload schemas, and error codes
- `docs/agent-setup.md` — end-to-end agent configuration guide covering session management, profiles, and tool registration

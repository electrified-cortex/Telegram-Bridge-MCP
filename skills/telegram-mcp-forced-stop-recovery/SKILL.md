---
name: telegram-mcp-forced-stop-recovery
description: >-
  Detection and recovery for agents that were force-terminated due to context
  exhaustion. Distinct from compaction recovery — covers the case where the agent
  had zero tokens left and could not call close_session, write a handoff, or
  notify anyone. Uses periodic checkpoints written during the dequeue loop as
  the primary recovery signal.
compatibility: "Requires Telegram MCP bridge; Claude Code project memory"
---

# Telegram MCP Forced-Stop Recovery

## What Is a Forced Stop

A **forced stop** occurs when Claude Code terminates an agent session because
the context window is completely full and no further compaction can proceed (or
Claude Code decides to stop the agent unconditionally). It is distinct from:

| Scenario | Signal | Recovery skill |
|----------|--------|----------------|
| **Compaction** | Context truncated but session survives | `telegram-mcp-post-compaction-recovery` |
| **Graceful shutdown** | Operator says stop; agent writes handoff, calls `action(type: "session/close")` | `telegram-mcp-graceful-shutdown` |
| **Forced stop** | Context limit hit; stop hook fires; agent has no tokens to respond | **this skill** |

### Stop Hook Edge Case

The stop hook (`telegram-loop-guard.ps1`) fires when VS Code tries to terminate
the conversation. The first time it fires, it blocks exit and tells the agent to
call `dequeue`. The hook guards against infinite loops via
`stop_hook_active`: if the hook has already fired once this turn
(`stop_hook_active == true`), the hook **passes through** and exit is allowed.

When an agent is at context limit:
1. The hook fires → agent is given one more turn but has no tokens to act
2. The hook fires again (`stop_hook_active == true`) → hook passes through
3. The process exits — no `action(type: "session/close")`, no handoff, no DM to the fleet

The session file (`TELEGRAM_SESSION_FILE`) still contains the token, so the
session appears "active" to the fleet but is actually orphaned.

---

## Periodic Checkpoint — The Dead Man's Switch

To survive a forced stop, agents write a compact **checkpoint** to their session
memory file on a regular interval. The checkpoint is the last known-good state
marker and is the primary evidence that the session was alive (or dead).

### Checkpoint Schedule

Every **10 dequeue cycles**, write the checkpoint. The cycle counter increments
once per `dequeue` call (regardless of whether a message was received).

### Checkpoint Format

Write to the agent's **session memory file** (same file used to store the
session token — specified in your agent instructions, e.g.
`memory/telegram/session.md`). Append or overwrite a checkpoint block at the
end of the file:

```markdown
## Checkpoint

Written: <ISO 8601 timestamp>
Cycle: <loop cycle count>
SID: <your SID>
Status: <"idle" | "in-progress: <task-id>">
```

**Write rules:**

- Write **in addition to** the token block — never replace the token.
- Use a simple overwrite of the full file (token block + checkpoint block).
- The write must be the **highest-priority action** at every 10th cycle:
  checkpoint before processing new messages, not after.
- If the memory write fails for any reason, skip it silently — do not let a
  checkpoint failure interrupt the dequeue loop.

### Example session memory file after checkpoint

```markdown
Token: 15443938
SID: 15
Name: Worker 2
Started: 2026-04-04T09:12:00Z

## Checkpoint

Written: 2026-04-04T11:47:22Z
Cycle: 130
SID: 15
Status: in-progress: 20-103
```

---

## Forced-Stop Detection on Startup

After recovering your session token and **before** testing the session with an
animation, check whether the previous stop was clean or forced.

### Detection Logic

Read the session memory file and compare timestamps:

| Condition | Interpretation |
|-----------|----------------|
| File is **empty or missing** | Fresh start — no previous session |
| File has a token, **no checkpoint block** | Previous session never completed 10 cycles — treat as clean start |
| File has a checkpoint, `handoff.md` is **non-blank** | Clean shutdown — handoff was written after the last checkpoint |
| File has a checkpoint, `handoff.md` is **blank or missing** | **Forced stop** — agent stopped without writing handoff |
| File has a checkpoint, agent does **not use handoffs** (e.g. Worker) | Compare checkpoint timestamp to session start time: if gap > 30 min and no clean close recorded, treat as forced stop |

> **Workers do not write handoffs.** For Workers, forced-stop detection relies
> solely on the checkpoint timestamp: if the checkpoint is present and recent
> (within the last session), a forced stop is assumed.

### Announcing Forced-Stop Recovery

If forced-stop is detected, announce it immediately after reconnecting to the
session — before draining messages, before loading profile. DM the **Curator**
(SID 1 / governor):

```text
⚠️ Forced-stop recovery: I was terminated uncleanly (context limit or hard stop).
Last checkpoint: <timestamp>, Cycle: <N>, Status: <idle | task-id>.
Session file was still live at startup — orphaned session cleaned up and replaced.
Resuming now.
```

Then continue with normal post-compaction or cold-start procedure.

This announcement is **distinct from compaction recovery** — use the
`⚠️ Forced-stop recovery` prefix, not the compaction recovery phrasing.

---

## Fleet Detection — Orphaned Sessions

The **Curator and Overseer** can detect orphaned sessions caused by forced stops:

### Orphaned Session Signs

- A session appears in `action(type: "session/list")` with no recent DM activity
- No `action(type: "session/close")` was observed for that SID
- The agent's handoff file is blank (for agents that use handoffs) or the
  checkpoint timestamp is stale (>30 min since last write)

### Overseer Action on Suspected Orphan

1. DM the suspected SID: *"Are you alive? Reply with your current status."*
2. Wait one full dequeue timeout (typically 30–60 seconds).
3. If no reply: treat the session as orphaned.
4. DM the Curator: *"SID <N> (<AgentName>) appears orphaned — no response, no
   close_session observed. Recommend respawn."*
5. On Curator confirmation: spawn a replacement using the standard spawn script.
   The replacement will detect forced-stop on startup and announce recovery.

> **Do NOT close another agent's session.** `close_session` closes **your**
> session. Orphaned sessions are cleaned up by the bridge when the replacement
> session starts — the old token simply becomes invalid.

---

## Integration with Other Skills

- **`telegram-mcp-post-compaction-recovery`:** Step 0 checks for forced-stop
  before proceeding with compaction recovery (see that skill).
- **`telegram-mcp-stop-hook-recovery`:** The "No Tokens Left" edge case
  documents how forced stops occur at the hook level (see that skill).
- **`agent-handoff`:** For agents that use handoffs (Overseer, Sentinel),
  a blank `handoff.md` combined with a present checkpoint is the primary
  forced-stop signal.
- **`telegram-mcp-session-startup`:** Step 0 of session startup should
  include forced-stop detection after reading the session memory file.

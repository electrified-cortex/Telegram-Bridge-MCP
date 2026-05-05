---
id: "10-0872"
title: "Watcher includes drained events in the wake notification — eliminate the second turn per wake"
type: feature
priority: 30
status: superseded
created: 2026-05-05
updated: 2026-05-05
repo: Telegram MCP
delegation: Curator
depends_on: ["10-0871", "10-0873"]
---

# Watcher includes drained events in the wake notification

## SUPERSEDED 2026-05-05

Operator clarified the architecture: long-poll dequeue is primary; Monitor is just a "kick the loop" nudge replacing the old Telegram loop guard. Content delivery stays in `dequeue` proper. Spoon-feeding events through Monitor is over-design — the current pattern of "watcher prints `call dequeue`, agent dequeues" is correct and wanted. See Curator memory `feedback_dequeue_long_poll_primary_monitor_nudge.md`.

No work required for this task. Kept in drafts as a record of the design exploration; do NOT execute.

10-0873 (HTTP /dequeue endpoint) remains useful for non-MCP consumers but is no longer central to the wake loop.

---

# Original draft (kept for reference)

## Operator framing (2026-05-05)

The real concern is **turn count**, not round-trips. Each Monitor wake triggers a fresh agent turn — and every turn re-uploads the agent's full context. Today's pattern (watcher prints `call dequeue()` → agent turn → agent calls `dequeue` MCP tool → drains) is *two* turns per inbound message: the wake turn that does nothing but call dequeue, then the work turn. Cut to one.

The watcher (a bash/PS subprocess outside the harness's MCP client) cannot speak MCP. It *can* speak HTTP. So if TMCP exposes dequeue over HTTP, the watcher curls dequeue itself on each mtime bump, embeds the drained events in the notification line, and the agent's first turn after a wake already has the messages — no second tool call required.

> "If monitor actually invoked, then it was a DQ, right? It was legitimately a DQ and we don't have to worry about skipping. Because if monitor occurred, you definitely DQ'd."
>   — operator, 2026-05-05

## What this depends on

- **`10-0873`** (sibling): TMCP exposes a curl-friendly HTTP endpoint that drains the session queue. Either a dedicated `/dequeue` shape OR documented use of the existing `/mcp` JSON-RPC endpoint. **Decision pending.**

This task is the watcher-side design + reference scripts. It cannot ship until 10-0873 lands or is decided not-needed.

## Approach

```bash
# Reference watcher (bash), launched by the agent with token + endpoint baked in:
f="<activity_file_path>"
endpoint="<dequeue_url_with_token_baked_in>"  # provided at watcher launch

prev=$(stat -c%Y "$f" 2>/dev/null)
while true; do
  cur=$(stat -c%Y "$f" 2>/dev/null)
  if [ -n "$cur" ] && [ "$cur" != "$prev" ]; then
    payload=$(curl -sS "$endpoint")
    echo "$payload"        # one notification line per wake = drained events
    prev=$cur
  fi
  sleep 1
done
```

PS counterpart uses `Invoke-RestMethod` with the same shape. The agent embeds the token into the curl command at watcher launch — token never lives loose in the watcher's environment.

## Properties

- **One turn per wake.** The wake notification contains the drained events; agent reads them, acts, replies — same turn.
- **Race-safe by construction.** If a new event arrives between drain and the next mtime bump, mtime bumps again and the watcher drains again. No skip-flag needed because each drain is genuinely consumed.
- **Token discipline.** Token lives in the curl URL/body, baked at launch. Watcher never reads `memory/telegram/session.token` — clean isolation.
- **Failure mode.** If the HTTP endpoint is down, curl returns an error message; the watcher emits that as a single notification line instead of going silent. Agent sees `"TMCP unreachable: <err>"` and can act.

## Iceboxed: dequeue `skip` parameter

Earlier framing proposed adding a `skip: number | number[]` parameter to the `dequeue` MCP tool, so the agent could re-call dequeue while skipping events the watcher already showed. Operator iceboxed this on 2026-05-05:

> "If monitor actually invoked, then it was a DQ. We don't have to worry about skipping. Not that we can't have skip as a feature, but I now kind of think it's not necessary."

Reasoning: with the watcher genuinely calling dequeue (not just peeking), drained events are gone from the queue — the agent never re-sees them, so no skip is needed. Skip stays on file as a future option if the contract weakens; it does NOT block this task.

## Reference scripts

Ship in TMCP repo `tools/`:

- `tools/activity-watcher.sh` — bash watcher (Linux/macOS/Git-Bash on Windows).
- `tools/activity-watcher.ps1` — PowerShell counterpart.

Each takes `<activity_file_path>` and `<dequeue_url>` as args; agents launch with token-embedded URL.

## Help-topic update

10-0871 already specs an `activity/file` help topic. After this task, that topic should reference the new watcher script names and show one-liner launch examples.

## Acceptance criteria

- Reference watcher scripts (bash + PS) live in `tools/` and run end-to-end against TMCP's HTTP dequeue endpoint.
- The `activity/file/create` response hint or related help topic points to the scripts.
- Verified: a Telegram message inbound produces a single agent-turn wake with the message content already in the notification — no follow-up `dequeue` MCP call.
- The activity-file fallback ("watcher prints `call dequeue()`, agent calls dequeue tool") still works for environments without `curl`/`Invoke-RestMethod`.

## Out of scope

- Adding the HTTP endpoint itself (10-0873).
- Deprecating the existing `dequeue` MCP tool — both patterns coexist.
- Moving Monitor to other agents' allowlists (workspace concern).

## Dispatch

Curator-owned design + scripts. Worker can implement the reference scripts once 10-0873 ships and shapes the URL contract.

## Bailout

If 10-0873 is decided not-needed (we settle on existing `/mcp` JSON-RPC), the watcher scripts adjust to wrap the JSON-RPC envelope; spec stays valid. If `curl` is unavailable on a target environment, fallback to the bell-only pattern; spec already mentions this.

## Notes

- This is the operator's "interim solution → ideal solution" pivot from prior session: the activity-file pattern *was* an interim wake-bell; the ideal makes the wake itself the message delivery.
- Pre-drain notification = better information density per turn = real token savings at fleet scale.

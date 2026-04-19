---
Created: 2026-04-06
Status: Draft
Host: local
Priority: 15-349
Source: Operator directive (leverage PostCompact hooks for tracking)
Depends: 20-347 (investigation — completed)
---

# Compaction Event Logging and Recovery via Hooks

## Objective

Rework the compaction hook strategy: PostCompact becomes the primary recovery
mechanism (injecting recent Telegram conversation as context), PreCompact
handles metrics logging only. Eliminate the fragile PreCompact blocking +
handoff file approach.

## Background

Investigation 20-347 confirmed Claude Code has native PreCompact/PostCompact
hooks. Current approach forces agents to write handoff files before compaction
(PreCompact blocking) — this is fragile because agents are at capacity when
PreCompact fires. Asking an overloaded agent to do MORE work at the worst
possible time produces low-quality results and adds failure risk.

**Key operator insights:**
- Telegram IS the persistent memory — the full conversation is stored server-side
- PreCompact is the wrong place to ask for work — let compaction happen cleanly
- PostCompact is where to invest — the agent is fresh and has full capacity
- PostCompact should give the agent: identity, recent messages, what to do,
  and what NOT to repeat

**Current state:**
- PreCompact hooks exist for all agents (blocking + handoff file demand)
- PostCompact hook exists ONLY for Overseer (`postcompact-dedup.ps1`)
- PostCompact reads the handoff file from PreCompact — still the old approach
- No Telegram-backed recovery exists for any agent

## Design

### Phase 1: PostCompact Recovery (Telegram-Backed)

Universal post-compact hook for all Telegram-connected agents:

1. Identify agent session (from env vars or config)
2. Call MCP bridge to retrieve recent Telegram messages for this session
3. Build recovery package:
   - Agent identity and session token
   - Recent messages (last N)
   - "DO NOT re-send any of these messages" warning
4. Inject as `additionalContext` via stdout JSON
5. Append JSONL log entry (timestamp, agent, sessionId, event: "post_compact")

**Overseer-specific recovery** (highest duplication risk):
- Stronger anti-duplication warning: "Check last few messages before sending
  anything. If you were about to send a message, verify it hasn't been sent."
- Include fleet status context if available

**Workers** and other agents get the standard recovery package — identity,
recent messages, and the basic dedup warning.

The recovery package gives the fresh agent everything it needs without relying
on anything the pre-compaction agent wrote.

### Phase 2: PreCompact — Remove Entirely

Don't deprecate — **delete** the PreCompact hooks. They were a reasonable guess
when we thought they were the only option, but PostCompact makes them
unnecessary.

1. Remove `.agents/hooks/pre-compact.ps1`
2. Remove `~/.claude/hooks/pre-compact.ps1`
3. Remove lock file mechanism (`temp/.compact-pending/`)
4. Remove handoff file mechanism entirely
5. Let compaction happen cleanly without any gate or burden

### Phase 3: Reporting

Create `tools/report-compactions.ps1`:
- Read all `compaction-events.jsonl` files
- Output per-agent compaction rates
- Support date range filtering

## Acceptance Criteria

- [ ] PostCompact hook injects recent Telegram messages as recovery context
- [ ] PostCompact hook logs compaction event to JSONL
- [ ] All PreCompact hooks deleted (`.agents/hooks/`, `~/.claude/hooks/`)
- [ ] PreCompact blocking mechanism removed
- [ ] Handoff file requirement eliminated
- [ ] Lock file mechanism removed (`temp/.compact-pending/`)
- [ ] `tools/report-compactions.ps1` reads and aggregates logs
- [ ] No regression in agent recovery quality
- [ ] Scope: Claude Code agents only (Copilot uses built-in summary)

## Open Questions

- What's the right number of recent messages to inject? (20? 50? — suggest 30 as default)
- Should PostCompact also include session memory files?
- How does the hook identify which agent/session it belongs to?
  (env vars: `MEMORY_PREFIX`, `CLAUDE_SESSION_ID`, or config file?)

### Resolved: Hook Access Mechanism

The MCP bridge has no custom REST API (only standard `/mcp` MCP protocol endpoints).
MCP tools cannot be called from a shell hook directly.

**Solution: Read the local NDJSON log.** The bridge writes every conversation event
to `data/logs/YYYY-MM-DDTHHMMSS.json` (NDJSON, one event per line, synchronous writes).
The PostCompact hook reads the most recent log file, extracts the last N events, filters
for relevant messages, and injects as `additionalContext` via stdout JSON.

```powershell
# Sketch (post-compact.ps1):
$logsDir  = "$env:MCP_BRIDGE_DIR/data/logs"
$latest   = Get-ChildItem $logsDir -Filter "*.json" | Sort-Object LastWriteTime | Select-Object -Last 1
$events   = Get-Content $latest.FullName | Select-Object -Last 50 | ForEach-Object { $_ | ConvertFrom-Json }
# Filter and format, then emit as additionalContext JSON to stdout
```

**Dependency:** Hooks need a `MCP_BRIDGE_DIR` env var pointing to the bridge install
path. Follow the existing `MCP_PORT` pattern — one-time config addition per agent.

### Resolved: VS Code / GitHub Copilot PostCompact

No PostCompact hook in VS Code or Copilot CLI. Copilot uses an automatic, system-managed
`<conversation-summary>` mechanism after compaction — not user-extensible. The built-in
summary captures conversation flow, technical state, and continuation plan reasonably well.
Conclusion: PostCompact hook work targets Claude Code session agents only. Copilot agents
rely on the built-in summary.

## Notes

- Keep hook scripts simple and fast — they run synchronously
- Log format: one JSON object per line (JSONL)
- This eliminates the fragile "ask an overloaded agent to do more work"
  pattern that the operator described as "kind of whack"
- PostCompact is the first thing a fresh agent sees — make the recovery
  package count
- Operator considers this high-value and may expand to an epic around
  agent lifecycle observability

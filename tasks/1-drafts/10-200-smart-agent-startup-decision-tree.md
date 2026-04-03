---
Created: 2026-04-03
Status: Draft
Priority: 10
Source: Operator directive (voice, 21948 + 21953)
Repo: electricessence/Telegram-Bridge-MCP
Branch target: dev
Related: 10-196, 15-197, 10-198
Type: Design + Implementation
---

# 10-200: Smart Agent Startup — Decision Tree & Skill

## Summary

Replace the current interactive resume/wipe/exit startup dialog with a smart,
autonomous decision tree that handles all startup scenarios without unnecessary
operator interaction. Implement as a startup skill and shell script.

## Input Variables

The agent checks three things on startup, in order:

| # | Check | How |
|---|-------|-----|
| 1 | **MCP available?** | HTTP probe to bridge port (e.g., 3099) |
| 2 | **Saved PIN?** | Check for session JSON file |
| 3 | **My session active?** | Call `list_sessions` (unauthenticated, see 10-198) |

## Decision Tree — All Permutations

```
START
│
├─ MCP NOT running
│  ├─ Have PIN → WIPE pin, STOP ("No MCP available")
│  └─ No PIN → STOP ("No MCP available")
│
└─ MCP IS running
   │
   ├─ No PIN, session NOT in list
   │  └─ CLEAN COLD START → request new session
   │
   ├─ Have PIN, session NOT in list
   │  └─ DIRTY COLD START → wipe PIN, then CLEAN COLD START
   │     (bridge restarted, old session gone)
   │
   ├─ No PIN, session IS in list
   │  └─ CONFLICT → another instance may be using my name
   │     → ASK operator: "Reconnect or Exit?"
   │     → If reconnect: try session_start(reconnect: true)
   │     → If exit: stop
   │
   ├─ Have PIN, session IS in list
   │  └─ WARM RECONNECT → try session_start(reconnect: true, pin)
   │     ├─ PIN accepted → RESUME (no operator interaction)
   │     ├─ PIN rejected → another client has this session
   │     │  → ASK operator: "Take over or Exit?"
   │     └─ Continuous rejection → EXIT (loop breaker)
   │
   └─ (Edge case) Have PIN, MCP running, probe fails
      └─ Treat as "MCP NOT running" → wipe + stop
```

## Scenario Details

### 1. Clean Cold Start
**Condition:** MCP up, no saved PIN, session not in list
**Action:** Standard `session_start` with fresh credentials
**Operator interaction:** None (except the initial session announcement)
**This is the happy path for first-time startup.**

### 2. Dirty Cold Start
**Condition:** MCP up, have saved PIN, session not in list
**Interpretation:** Bridge restarted. Old session is gone. PIN is stale.
**Action:** Wipe session JSON, proceed as Clean Cold Start
**Operator interaction:** None

### 3. No MCP Available
**Condition:** MCP not responding on expected port
**Action:** If PIN exists, wipe it (stale state). Stop with clear error.
**Operator interaction:** None (agent logs the issue)
**Rationale:** No MCP = nothing to connect to. Wiping stale PIN prevents
confusion on next startup.

### 4. Conflict — Session Exists, No PIN
**Condition:** MCP up, no saved PIN, but my session name IS in the list
**Interpretation:** Another instance of this agent might be running, or
the agent crashed without cleaning up. The operator needs to decide.
**Action:** Prompt operator: "Worker 1 is already active. Reconnect or Exit?"
**Operator interaction:** Required (can't safely stomp another instance)

### 5. Warm Reconnect
**Condition:** MCP up, have saved PIN, session IS in list
**Interpretation:** Agent is rejoining after a context compaction, sleep, or
planned bounce.
**Action:** Try `session_start(reconnect: true)` with saved SID+PIN
- **Success:** Resume silently, no operator dialog needed
- **Failure (PIN rejected):** Another client has this session → ask operator
- **Repeated failure:** Exit (prevent infinite loop)
**Operator interaction:** Only on PIN rejection

### 6. Bounce Wait
**Condition:** After a planned bounce, agent checks and session still exists
with its own PIN
**Interpretation:** Bridge hasn't restarted yet — the bounce is still in progress
**Action:** Sleep 60 seconds, retry the probe
**Loop limit:** Max N retries (e.g., 5 = 5 minutes), then exit

## Implementation Plan

### Phase 1 — Sub-Skills (documentation, context-optimized)
Break the decision tree into individual sub-skills so agents only load the
context for their specific scenario:

| Sub-Skill | When Loaded |
|-----------|-------------|
| `telegram-mcp-cold-start` | Fresh start, no existing session |
| `telegram-mcp-warm-reconnect` | Rejoining with saved PIN |
| `telegram-mcp-conflict-resolution` | Session exists but credentials missing/rejected |
| `telegram-mcp-no-mcp-available` | Bridge not responding |

The startup script determines which scenario applies and passes the result to
the agent, which then loads ONLY the relevant sub-skill. This minimizes context
consumption — the agent never loads the full decision tree.

### Phase 2 — Deterministic Startup Script
Create a `smart-connect.sh` (bash, with `.ps1` wrapper) that runs the complete
decision tree as **pure deterministic logic** — no LLM reasoning involved.

**Design principle:** The script IS the state machine. The LLM is just the
executor that acts on the result. Zero agent context spent on decision-making.

**Input:** Path to session file (contains SID, PIN, memory location)

**Output:** Exactly one of:
```
RESUMING <sid> <pin>     # Warm reconnect — use this identity
FRESH <sid> <pin>        # New session created — use this identity
ASK_RECONNECT            # Conflict detected — agent must ask operator
NO_MCP                   # Bridge not available — agent should stop
```

The agent's `spawn.ps1` calls this script BEFORE entering the Telegram loop.
The script handles:
1. MCP liveness probe (HTTP check on bridge port)
2. Session file parsing (extract saved SID/PIN if present)
3. Unauthenticated session list call (which SIDs are active?)
4. Decision tree execution (all permutations)
5. If needed: creates new session via API call
6. Outputs the result for the agent to consume

### Phase 3 — Bridge-Side Changes
- 10-198: Unauthenticated `list_sessions` (prerequisite)
- Silent reconnect mode on `session_start(reconnect: true)` — skip operator
  approval when PIN matches and no conflict

## Acceptance Criteria

- [ ] Decision tree covers all 2×2×2 = 8 permutations (with edge cases)
- [ ] Skill document written and referenced by agent CLAUDE.md files
- [ ] Shell script implemented and tested
- [ ] Clean cold start requires zero operator interaction
- [ ] Dirty cold start requires zero operator interaction
- [ ] Warm reconnect requires zero operator interaction (on success)
- [ ] Conflict scenario properly escalates to operator
- [ ] No infinite reconnect loops (fail-safe exit)

## Reversal Plan

Revert to existing resume/wipe/exit interactive dialog. Remove skill and script.

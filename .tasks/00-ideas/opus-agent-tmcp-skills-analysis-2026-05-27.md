# Opus agent TMCP skills analysis — 2026-05-27

Agent aba895897d9246615, 68k tokens, ~160s. Clean-scope analysis of all 15 TMCP skills.

## Verdict: 14 → 3 skills (80% cut)

### Minimum viable set (3 survivors)
1. `telegram-participation` — full lifecycle R1–R8. The keystone.
2. `telegram-mcp-communication` — tool selection, button design, async-wait, presence cascade. Minor fix: replace "VS Code chat" → "agent panel/host UI"
3. `reminder-driven-followup` — reminder API + delegation pattern. Fix: strip role names (Governor/Supervising/Subordinate)

### Archive/delete: 11 skills
- `telegram-mcp-session-startup` — wholly superseded by participation R1–R5; stale token-file refs, role hierarchy
- `telegram-mcp-post-compaction-recovery` — wholly superseded by participation R3+R5A; predates activity-file model
- `telegram-mcp-graceful-shutdown` — superseded by R8; kill.sh + pod_root + PID violations
- `telegram-mcp-shutdown-protocol` — superseded by R8; "Governor" + "loop guard" references
- `telegram-mcp-forced-stop-recovery` — ENTIRELY Claude-Code artifact (stop hook, TELEGRAM_SESSION_FILE, checkpoint)
- `telegram-mcp-stop-hook-recovery` — ENTIRELY VS Code stop-hook artifact
- `telegram-mcp-dequeue-loop` — fully redundant (R7 + comms cover it); capture 1 unique paragraph in R7
- `telegram-mcp-close-orphaned-session` — situational operator recipe; candidate for help('orphaned-cleanup') bridge doc
- `telegram-mcp-dump-handling` — workspace-coupled (git + logs/telegram/); not a bridge participant skill
- `sub-session-dispatch` — cortex-pod workflow (inbox/ + tasks/ paths, cross-plugin skill refs); belongs in electrified-cortex/skills/ or stations/skills/, NOT TMCP
- `animation-signaling-protocol` — fold preset table + rules into telegram-mcp-communication; delete standalone
- `file-watching` — confirmed NOT a bridge skill; duplicated at electrified-cortex/skills/; archive/delete

## Key harness violations found
- graceful-shutdown: kill.sh, <pod_root>, PID files, role-coupled DM
- forced-stop-recovery: ENTIRE file is Claude-Code/stop-hook artifact
- stop-hook-recovery: ENTIRE file is VS Code stop-hook artifact
- session-startup: chain-of-command DMs, session.md paths, role hierarchy
- dump-handling: git commits, logs/telegram/ workspace paths
- sub-session-dispatch: inbox/, tasks/00-ideas/, tasks/10-drafts/, cross-plugin skill refs

## What's missing from participation (3 gaps)
1. Communication conventions → covered by telegram-mcp-communication
2. Reminder API → covered by reminder-driven-followup  
3. Animation presets → fold into telegram-mcp-communication

## Copilot agent vs Opus agent divergence
Copilot said 15→10. Opus said 14→3.
Opus correctly flagged: sub-session-dispatch (cortex-pod), dump-handling (workspace-coupled), 
close-orphaned-session (not a runtime skill), dequeue-loop (fully redundant) as not earning their place.

---

## Gap: sub-session-dispatch has no help() topic

Confirmed via `help(topic: 'sub-session')` → UNKNOWN_TOPIC.

Operator directive: ensure every skill topic is covered by help and properly indexed.

**Resolution options:**
A. Add harness-agnostic `help('sub-session')` topic to the bridge (bridge-side change)
B. Accept the gap — sub-session dispatch is pod-coupled anyway; belongs in stations/skills/ not TMCP

Recommendation: B first (move to stations/), then A separately if operator wants generic sub-session dispatch in the bridge.

## Minor: recovery.md pseudocode bug

`context/recovery.md` line 8: `action(type: 'help', topic: 'compacted')`
Should be: `help(topic: 'compacted')` — `action()` dispatcher doesn't handle help.
Low priority; agent competency compensates.

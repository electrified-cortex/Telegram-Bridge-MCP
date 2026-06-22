# Copilot agent TMCP skills analysis — 2026-05-27

Pasted by operator, message 62619 (the "from another agent review" result).

## Findings: 15 → 10 skills

### Clusters to collapse

**Cluster 1 — Session lifecycle (3→1)**
- telegram-mcp-session-startup
- telegram-participation (supersetting skill)
- telegram-mcp-post-compaction-recovery
→ Proposed: telegram-mcp-session-lifecycle

**Cluster 2 — Shutdown (2→1)**
- telegram-mcp-shutdown-protocol (thin wrapper → chains to graceful-shutdown)
- telegram-mcp-graceful-shutdown
→ Proposed: telegram-mcp-graceful-shutdown (absorbs bridge-level events from shutdown-protocol)

**Cluster 3 — Recovery (3→1)**
- telegram-mcp-stop-hook-recovery
- telegram-mcp-forced-stop-recovery
- telegram-mcp-post-compaction-recovery (also in Cluster 1)
→ Proposed: telegram-mcp-session-recovery

**Cluster 4 — Communication + Animation (2→1)**
- animation-signaling-protocol → folded into telegram-mcp-communication
→ Proposed: telegram-mcp-communication (gains animation section)

### Surviving skills (keep)
- telegram-mcp-dequeue-loop (trim messaging guidelines section, cross-ref comms)
- telegram-mcp-close-orphaned-session
- telegram-mcp-dump-handling
- reminder-driven-followup
- sub-session-dispatch
- file-watching (pure utility, no overlap)

## Proposed partitioning
lifecycle / loop / comms / shutdown / recovery / orphan / dumps / reminders / sub-session / file-watch

## Agent's question
Implementation of merges was proposed but not authorized. Operator approval required per change.

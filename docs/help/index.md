Telegram Bridge MCP — Skill Index

Categorized routing menu. Call help(topic: '<name>') to navigate.
Call help() for tool index. Call help(topic: 'index') to return here.

GETTING STARTED
  help(topic: 'startup')     — Post-session-start checklist (token, profile, loop entry)
  help(topic: 'quick_start') — Minimum to operate (dequeue + send + react basics)
  help(topic: 'guide')       — Full agent communication guide

CORE OPERATIONS
  help(topic: 'dequeue')     — Dequeue loop: heartbeat, drain, block, react rules
  help(topic: 'reminders')   — Reminder-first delegation and async follow-up
  help(topic: 'animation')   — Animation frames and named presets
  help(topic: 'checklist')   — Checklist step status values

RECOVERY
  help(topic: 'compacted')   — Post-compaction recovery (token lost, context reset)
  help(topic: 'forced-stop') — Forced stop detection, checkpoint pattern, restart
  help(topic: 'stop-hook')   — VS Code stop hook fires — immediate action

SESSION LIFECYCLE
  help(topic: 'shutdown')    — Graceful shutdown (common + governor + Worker kill)
  help(topic: 'orphaned')    — Close orphaned session (no active agent, SID dangling)
  help(topic: 'dump')        — Session dump filing (inline + periodic)

REFERENCE
  help(topic: 'compression') — Message brevity tiers (None/Lite/Full/Ultra)
  help(topic: 'identity')    — Bot info + MCP server version (requires token)

PER-TOOL DOCS
  help(topic: '<tool_name>') — Detailed docs for any registered tool (see tool index)

DEEP REFERENCE
  Each topic includes: Full reference: skills/<skill-name>/SKILL.md
  Agents can bootstrap entirely from help() — no external skill files required on startup.

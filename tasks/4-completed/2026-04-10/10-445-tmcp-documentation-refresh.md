---
Created: 2026-04-10
Status: Complete
Host: local
Priority: 05-445
Source: Operator (voice directive 2026-04-10)
---

# TMCP Documentation Refresh

## Objective

Update Telegram Bridge MCP documentation to reflect the current v6.0.0 state.
README, tool definitions, and feature highlights must be accurate and emphasize
the streamlined MCP surface and hybrid messaging capabilities.

**This is a blocking prerequisite for PR #126 merge.** Stale documentation is
causing the Copilot reviewer to generate false-positive review threads. Docs
must be accurate before the next Copilot exhaustion cycle.

## Context

The TMCP has evolved significantly through the v6.0.0 development cycle. Key
features like hybrid messaging (audio + text in a single `send` call), the
streamlined action surface, super tools (checklists, progress bars), and
multi-session coordination are either undocumented or understated. The operator
wants the documentation to be a clear showcase of what the bridge can do.

The stale documentation is actively hindering PR review — Copilot is flagging
code as incorrect because the docs describe old behavior. Fix docs first, then
re-trigger the Copilot review.

## Acceptance Criteria

- [x] README.md is current — reflects v6.0.0 feature set, not legacy v5
- [x] All tool definitions (`src/tools/*.ts`) have accurate JSDoc descriptions
- [x] Hybrid messaging (audio + text in one message) is prominently featured
- [x] Streamlined MCP surface is emphasized (fewer tools, more capability per tool)
- [x] Super tools (checklists, progress bars, questions) are documented with examples
- [x] Multi-session coordination features documented (session list, DMs, governor)
- [x] Action registry paths are accurate (post-refactor: `profile/*`, `reminder/*`, etc.)
- [x] No stale references to removed features or old action paths

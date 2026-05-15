---
id: "00-0001"
title: "Epic: Telegram-specific skills library inside TMCP with Claude Code plugin"
type: epic
priority: 0
created: 2026-05-15
delegation: Curator
target_branch: dev
---

# Epic: Telegram-specific skills library inside TMCP with Claude Code plugin

## Context

Operator direction (2026-05-15): Telegram-participation and any other Telegram-specific skills currently scattered across electrified-cortex/skills or other repos belong inside the Telegram MCP repo itself. TMCP is the canonical home for everything Telegram-specific.

The current placement (skills in electrified-cortex/skills, not in TMCP) creates friction: agents have to import from an unrelated repo, the skills are hard to discover, and the plugin architecture makes fully-qualified names clunky. Moving them into TMCP and publishing a Claude Code plugin from that repo solves both problems.

## Goal

Create a Telegram-specific skills library that:

1. **Lives inside TMCP** — a dedicated `skills/` folder (or similar) within the Telegram MCP repo, versioned and maintained alongside the server.
2. **Covers Telegram-specific agent skills** — including (at minimum): `telegram-participation`, `telegram-etiquette`, activity-file management, compaction recovery patterns.
3. **Ships as a Claude Code plugin** — so any agent with the plugin installed gets the full Telegram skill set without manual import or path-wrangling. Plugin registration follows the Claude Code plugin architecture.
4. **Replaces the scattered skills** — once live, the skills in electrified-cortex/skills that are Telegram-specific should be deprecated or removed in favor of the TMCP-native versions.

## Sub-tasks (to be specced by Curator)

- Audit which skills currently live in electrified-cortex/skills and are Telegram-specific
- Design the `skills/` folder layout inside TMCP
- Spec the Claude Code plugin manifest and registration
- Migrate `telegram-participation` skill content into TMCP
- Migrate `telegram-etiquette` skill content into TMCP (currently in overseer new-skills — not yet promoted)
- Deprecation plan for the skills in electrified-cortex/skills
- Update any agents that currently import from electrified-cortex/skills for Telegram skills
- Codify dequeue polling cadence in telegram-participation (long-poll default, instant-poll when draining, drain-to-empty on monitor kick) — from .agents task 30-1932
- Add markdown table avoidance guidance to telegram-participation (Layer 1 sender discipline; Layer 2 TMCP advisory already ships) — from .agents task 30-1933

## Out of scope

- Non-Telegram skills (those stay in electrified-cortex/skills or their own repos)
- Changing the TMCP server architecture

## Source

Operator request 2026-05-15: "create a skills library that lives in telegram MCP that's specific to telegram that also has a Claude code plugin and everybody's happy."

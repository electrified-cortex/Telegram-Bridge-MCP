---
created: 2026-06-12
status: icebox
priority: 30
source: harness-task-8
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
agent_type: Worker
model_class: opus-class
reasoning_effort: high
---

# 30-0010 — Bot API 10.1 rich-messages epic (parked)

## Context

Telegram Bot API 10.1 introduces rich message types (media groups, interactive buttons, inline keyboards at scale). Adopting these would enhance agent-to-human communication quality. This epic is parked pending prioritization — no current sprint allocation.

## Objective

When activated: design and implement TMCP support for Bot API 10.1 rich message types, enabling agents to send formatted media groups and interactive elements via the MCP tool interface.

## Acceptance Criteria

1. TMCP exposes at least one new tool covering a Bot API 10.1 rich message type.
2. Existing text-send tools are unaffected.
3. New tools are documented in the TMCP skill.
4. Integration test covers the new tool end-to-end with a real Bot API call.

## Scope boundary

- Parked; do not begin without operator reactivation.
- Scope of specific Bot API 10.1 features TBD at activation time.

## Delegation

Executor: Worker / Reviewer: Curator

## Priority

Priority: 30 — icebox-candidate

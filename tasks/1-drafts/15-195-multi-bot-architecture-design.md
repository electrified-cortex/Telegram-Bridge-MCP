---
Created: 2026-04-03
Status: Draft
Priority: 15
Source: Operator directive (voice)
Epic: Bot API 9.6
Repo: electricessence/Telegram-Bridge-MCP
Branch target: dev
Depends: 15-193
---

# 15-195: Multi-Bot Architecture — Managed Bot Fleet Design

## Epic Context

Part of the **Bot API 9.6 epic**. This is the architectural design task that
determines how the bridge evolves from single-bot to multi-bot operation.
See full analysis at `cortex.lan/docs/research/2026-04-03-bot-api-96-analysis.md`.

Related tasks: 10-192 (foundation), 15-193 (prerequisite — raw API tools)

## Goal

Design the architecture for running multiple Telegram bots (one manager + N
managed bots) through a single MCP bridge instance. This is a design document
task — no implementation until the design is reviewed and approved.

## Context

Bot API 9.6's Managed Bots feature allows a "manager" bot to programmatically
create and control child bots. This maps directly to our agent fleet:

- **Manager bot** = the bridge's main bot (handles Curator, Overseer, operators)
- **Managed bots** = dedicated bots per agent role (Worker 1, Worker 2, Sentinel)

### Current Architecture (single bot)
```
Bridge → Bot Token → grammY API → Telegram
         ↕
    Session Manager (SID/PIN multiplexing)
    Message Store (single update stream)
    Poller (single getUpdates loop)
```

### Proposed Architecture (multi-bot)
```
Bridge → Manager Bot Token → grammY API → Telegram
         ↕
    Manager Bot Instance (Curator, Overseer, Operators)
    ├── Managed Bot 1 (Worker 1) — own token, own poller?
    ├── Managed Bot 2 (Worker 2) — own token, own poller?
    └── Managed Bot 3 (Sentinel) — own token, own poller?
```

## Design Questions

1. **Poller per bot?** Each managed bot needs its own `getUpdates` stream.
   Does this mean N pollers? Or a single coordinator?
2. **Session mapping:** Does each managed bot get its own session manager?
   Or does the existing SID/PIN system span across bots?
3. **Message store:** Unified store across all bots? Or per-bot stores?
4. **MCP tool routing:** How does an agent specify which bot to use? New
   parameter on every tool? Or session-level bot binding?
5. **Token lifecycle:** How are managed bot tokens provisioned, stored, and
   rotated? What happens if the manager token is rotated?
6. **Gradual migration:** Can we run single-bot and multi-bot modes
   simultaneously during transition?

## Deliverable

A design document (markdown) covering:
- Architecture diagram
- Component responsibilities
- API surface changes
- Migration path from single-bot to multi-bot
- Security considerations (token storage, isolation)
- Resource implications (N pollers = N long-poll connections)

## Acceptance Criteria

- [ ] Design document written and reviewed by operator
- [ ] Architecture diagram included
- [ ] All design questions above addressed
- [ ] Security section covers token storage and isolation
- [ ] Migration path documented

## Notes

This is a design-only task. Implementation tasks will be created after the
design is approved.

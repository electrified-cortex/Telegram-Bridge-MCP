---
Created: 2026-04-12
Status: Draft
Host: local
Priority: 10-496
Source: Operator directive (dogfooding critique)
---

# 10-496: Guide content audit and help/guidance separation

## Objective

Audit the agent communication guide (`docs/behavior.md`) and extract
content into appropriate homes. Two axes of separation:

1. **Content extraction** — move topic-specific material to individual
   help hints (e.g., animation → `help('animation')`, compression →
   `help('compression')`)
2. **Help vs guidance** — distinguish tool documentation ("how to call X")
   from Telegram etiquette/conventions ("when to use voice vs text")

## Context

The guide is ~32KB and mixes:
- Tool usage patterns (belongs in per-tool help topics)
- Dequeue loop mechanics (belongs in `help('start')`)
- Compression tiers (already duplicated in `help('compression')`)
- Animation guidance (already duplicated in `help('animation')`)
- Telegram etiquette (belongs in guide or a separate 'etiquette' topic)
- Multi-session routing (belongs in guide or 'routing' topic)

Some content is duplicated between the guide and help topics. The audit
should identify every duplication and decide where the canonical copy lives.

## Prerequisites

- 10-495 (guide spec) — defines scope boundaries

## Deliverable

1. An audit document mapping each guide section to its target home
2. Implementation: extract identified content, update guide, update help topics
3. Guide shrunk to spec-defined size constraint

## Acceptance Criteria

- [ ] Every guide section mapped to: keep in guide / move to help topic / move to skill / remove (duplicate)
- [ ] No content duplication between guide and help topics
- [ ] Guide size within spec-defined constraint (10-495)
- [ ] All extracted content accessible via appropriate help topics
- [ ] "Help" (tool docs) clearly separated from "guidance" (etiquette/conventions)
- [ ] Existing help topics updated with extracted content where needed

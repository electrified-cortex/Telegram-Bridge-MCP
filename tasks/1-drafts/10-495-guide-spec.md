---
Created: 2026-04-12
Status: Draft
Host: local
Priority: 10-495
Source: Operator directive (dogfooding critique)
---

# 10-495: Agent communication guide spec

## Objective

Write a `guide.spec.md` that defines the purpose, structure, scope, and
size constraints of the agent communication guide (`docs/behavior.md`).
The guide is currently ~32KB — a context bomb for agents that follow
the startup chain. The spec must establish what belongs in the guide vs
what belongs in help topics, skills, or agent files.

## Context

The guide is served via `help(topic: 'guide')` and contains everything:
tool usage, Telegram etiquette, multi-session routing, compression tiers,
animation conventions, dequeue patterns, and more. Some of this content
is duplicated in help topics (compression, checklist, animation) or
belongs in agent specs.

Dogfooding showed agents obediently loading 32KB into context before
doing any work. The guide needs a clear spec defining its boundaries.

## Deliverable

A `docs/guide.spec.md` file defining:

1. **Purpose** — what the guide IS (reference manual for Telegram bridge
   communication patterns)
2. **Audience** — who reads it (agents using the TMCP bridge)
3. **Scope boundaries** — what belongs in the guide vs elsewhere
4. **Structure** — required sections and their order
5. **Size constraint** — target token budget (e.g., <8KB / <2K tokens)
6. **Extraction rules** — criteria for moving content to help topics
7. **Content compression rules** — instructions only in content, explanations
   in the spec. Don't include prose explanations in files agents read —
   agents follow instructions, they don't benefit from "why" text.
   Use ultra compression (agent audience). Spec can be verbose.

## Acceptance Criteria

- [ ] `docs/guide.spec.md` exists with all sections above
- [ ] Spec defines clear scope boundaries (guide vs help topic vs skill)
- [ ] Spec includes a target size constraint with rationale
- [ ] Spec lists content categories that belong in the guide
- [ ] Spec lists content categories that do NOT belong in the guide
- [ ] Spec includes content compression rules (instructions vs explanations)

## Notes

- This spec shapes 10-496 (guide content audit). Write spec first.
- Operator involvement: spec review before audit proceeds.
- Key principle: "Don't explain what agents should just follow. Instructions
  only in agent-facing content. Explanations live in the spec."

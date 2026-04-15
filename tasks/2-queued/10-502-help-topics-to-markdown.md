---
Created: 2026-04-12
Status: Draft
Host: local
Priority: 10-502
Source: Operator directive (dogfooding critique)
---

# 10-502: Extract help topics to markdown files

## Objective

Move all help topic content from embedded TypeScript string arrays to
individual markdown files in `docs/help/`. Code becomes a thin loader
that reads and serves the files.

## Context

Currently `help.ts` embeds topic content as string arrays (startup,
quick_start, compression, checklist, animation) while the guide already
loads from `docs/behavior.md`. This inconsistency makes content harder
to edit, audit, and compress.

All topic content should live as markdown files alongside companion
`.spec.md` files. The code just loads: `readFileSync(topic + '.md')`.

## Proposed Structure

```
docs/help/
  start.md              ← help('start') content
  start.spec.md         ← design rationale
  guide.md              ← communication etiquette (renamed from behavior.md)
  guide.spec.md         ← exists (just created)
  compression.md        ← compression tiers
  animation.md          ← animation frames
  checklist.md          ← checklist statuses
  dequeue.md            ← dequeue patterns (new)
```

## Changes

1. Create `docs/help/` directory
2. Extract each embedded topic to its own `.md` file
3. Move `docs/behavior.md` → `docs/help/guide.md`
4. Update `help.ts` to load all topics from `docs/help/<topic>.md`
5. Remove embedded string arrays from `help.ts`
6. Add fallback error if file not found

## Prerequisites

- 10-494 (startup chain redesign) — new topic names and content
- 10-495 (guide spec) — defines guide scope

## Acceptance Criteria

- [ ] All help topics served from `docs/help/<topic>.md` files
- [ ] No content embedded in TypeScript source
- [ ] `docs/behavior.md` relocated to `docs/help/guide.md`
- [ ] Each topic file has a companion `.spec.md`
- [ ] Graceful error if topic file missing
- [ ] Content identical before and after extraction (no regressions)
- [ ] Tests updated for file-based loading

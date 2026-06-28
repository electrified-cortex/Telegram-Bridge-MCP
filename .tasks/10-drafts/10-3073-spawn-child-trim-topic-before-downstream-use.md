# 10-0009 — session/spawn-child: trim topic before downstream use

**Priority**: Low  
**Tier**: Draft  
**Source**: WARN-3 from 10-0008 Overseer gate review (2026-06-28)

## Problem

In `src/tools/session/spawn-child.ts`, `topic.trim()` is used only in the rejection guard:

```typescript
if (!topic || !topic.trim()) { return toError(...) }
// raw topic (possibly " pref-rank ") flows downstream:
setTopic(sid, topic)
childSession.name = `${topic} ①`
// ... etc
```

A caller passing `" pref-rank "` would pass validation but produce a chip reading `" pref-rank  ①"` (with leading/trailing spaces). The child nametag and topic storage also receive the raw padded value.

## Fix

One line after the guard:

```typescript
const trimmedTopic = topic.trim()
```

Replace all downstream uses of `topic` with `trimmedTopic` (setTopic, child name construction, SPAWN_CHILD_SUBAGENT_HINT, etc.).

## Acceptance Criteria

- [ ] `const trimmedTopic = topic.trim()` declared after validation guard
- [ ] All downstream assignments use `trimmedTopic` (not raw `topic`)
- [ ] Test: `topic: "  pref-rank  "` → child chip label is `"pref-rank ①"` (no padding)
- [ ] `tsc --noEmit` passes
- [ ] All pre-existing tests pass

## Scope

- `src/tools/session/spawn-child.ts` only (+ its test file)

## Delegation

Executor: Worker / Reviewer: Curator

---
Created: 2026-04-16
Status: Queued
Target: telegram-mcp-bridge
---

# 10-584 — Ultra-compress docs/help/ Topics

## Goal

Apply ultra-compression to all docs/help/ files to reduce
token cost when agents call help(). Content should be
agent-readable, not human-readable. Strip all markdown
formatting that doesn't affect comprehension. Terse,
dense, zero fluff.

## Scope

All files in docs/help/ and subdirectories. ~130 help
topic files.

## Approach

For each file:
1. Read current content
2. Apply ultra-compression: strip headers where a label
   suffices, collapse examples, remove redundant words,
   eliminate markdown formatting that adds no information
3. Preserve: code examples, parameter names, action paths,
   error codes — anything agents need to call the API
4. Keep uncompressed versions as .uncompressed.md if they
   don't already exist

## Acceptance Criteria

- [ ] All help docs compressed
- [ ] help() still returns useful, accurate content
- [ ] Tests pass (help tests check for key content)
- [ ] No information loss — just formatting reduction

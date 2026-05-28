---
Created: 2026-05-27
Updated: 2026-05-27
Status: Draft
Host: local
Priority: TBD
Source: Operator (voice msgs 62713–62714, 2026-05-27)
Target: V8
---

# V8 Help Coverage — Every Tool/Path Has a Help Topic

## Objective

Every TMCP action path, tool, and feature has its own help() topic. The index reflects all of them. Help content is accurate, comments are correct, and tests pass without dead or misleading cases.

Operator directive (2026-05-27): "Each tool call should have its own help. Everything has a help. There are blanket help topics, there's an index — as all should be up to date for V8."

## Scope

### 1. Help topic coverage audit

- Enumerate every action sub-path (`action(type: 'X')`) registered in the bridge.
- For each path: verify a help topic exists in `docs/help/`.
- Flag any path with no dedicated help file.
- Known gap going into this: `sub-session` (drafted 2026-05-27, staged).

### 2. Index completeness

- `docs/help/index.md` currently lists ~15 of ~50 help files.
- Every help topic must appear in the index under an appropriate section.
- Topics may be grouped by category (getting started, core ops, session lifecycle, reference, per-tool).

### 3. Help topic accuracy

- Each help file reflects current V8 API (no stale v6/v7 paths or deprecated params).
- Action paths with schema changes in V8 must have updated help.
- Cross-references between topics (`help('X')` breadcrumbs) must resolve to real topics.

### 4. Code comments

- Inline comments in `src/` that describe behavior must match actual behavior.
- Remove stale TODOs and comments referencing superseded designs.

### 5. Test cleanup

- Remove tests for paths that no longer exist.
- Ensure all R*/AC items in shipped specs have test coverage.
- Known gap: `session/spawn-child` capability check (R8 from spawn-child-service-message-chain) requires two test paths (action-dispatch and direct MCP tool call).

## Out of scope (V8)

- New features not already in the backlog.
- Haiku router, threaded conversations, per-SID message/history filter — filed separately.

## Acceptance criteria

- [ ] Every registered action path has a corresponding help() topic.
- [ ] `docs/help/index.md` lists all help topics.
- [ ] `help('index')` call returns a complete, accurate menu.
- [ ] No help() topic references a deprecated path or tool.
- [ ] Code comments in `src/` are accurate or removed.
- [ ] Test suite has no dead tests; spawn-child capability R8 test gap closed.

## Delivery

Break into per-path tasks once the coverage audit produces the gap list. Dispatch background agents for mechanical help-topic writes; Curator/BT review staged output before merge.

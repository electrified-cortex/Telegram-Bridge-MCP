# Strengthen activity/file onboarding for Monitor-capable runtimes

## Problem
The onboarding_loop_pattern service message mentions activity files as an "augment" but language is too weak. Agents in Monitor-capable runtimes (Claude Code) don't automatically wire it up.

## Goal
Update onboarding language to be runtime-conditional:
- If runtime has Monitor/file-watcher → create activity file + start watcher background process → Monitor fires → dequeue(max_wait: 0)
- If runtime lacks Monitor (VS Code etc.) → skip gracefully, use standard long-poll

## Acceptance criteria
- [ ] onboarding_loop_pattern message updated with runtime-conditional guidance
- [ ] Concrete bash/PS example of mtime watcher provided
- [ ] Non-Monitor runtimes don't break or get confused
- [ ] Tested in Claude Code: activity file wired, Monitor fires on inbound message, dequeue called

## Notes
Filed 2026-05-05 based on operator feedback session.

## Related / partially superseded

Task **15-0899** (merged) published the canonical `Monitor` recipe as a shared constant and surfaced it from `session/start`, `session/reconnect`, and `help('activity/file')`. The concrete bash mtime-poll watcher example and `Monitor` parameter guidance are now in `docs/help/activity/file.md` (§ "Canonical Monitor recipe (Claude Code)").

Remaining scope here: runtime-conditional onboarding language in `ONBOARDING_LOOP_PATTERN` and Claude Code–specific auto-wiring guidance. The recipe constant (`src/tools/activity/canonical-recipe.ts`) can be reused.

## Gate bounce — Overseer 2026-06-20

BOUNCE — needs-refinement. Reasons:

1. **No YAML frontmatter** — missing priority, agent_type, model_class, reasoning_effort.
2. **No delegation block** — no Executor/Reviewer.
3. **AC #2 stale** — "Concrete bash/PS example of mtime watcher" was already delivered by 15-0899. AC must be updated or dropped.
4. **AC #3 untestable** — "Non-Monitor runtimes don't break or get confused" is subjective. Needs explicit expected behavior: what does VS Code receive? Does the section render? Is there a test?
5. **Runtime detection unspecified** — how does TMCP know the runtime is Monitor-capable? This is an open design question that must be resolved before implementation.
6. **No file-scope list** — which specific files/constants get modified? (`ONBOARDING_LOOP_PATTERN` location not specified)

Fix: add frontmatter, resolve runtime detection design, update ACs to reflect 15-0899's deliveries, define explicit expected behavior for non-Monitor runtimes.

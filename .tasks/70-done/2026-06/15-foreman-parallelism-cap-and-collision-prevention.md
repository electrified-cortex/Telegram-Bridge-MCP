---
title: "Foreman agent: add Fleet Management section"
priority: 15
type: guideline-addition
agent_type: Curator
dispatch_ready: true
needs_operator: false
created: 2026-06-21
updated: 2026-06-21
source: operator-voice-77497-77498-77504-77506-77507-77508-77511
curator_review: approved-2026-06-21-final
---

# Foreman agent: add Fleet Management section

## What

Add a brief "Fleet Management" section to the foreman's core agent markdown. One short paragraph (or a few bullet points at most). This is a guideline addition — no code change, no worker needed. Curator authors directly.

## Operator direction (voice 77511, 2026-06-21 — verbatim intent)

> "It should be no more than a paragraph… a section in the markdown of its agent file… it talks about fleet management, right? And explains how it's supposed to scale and how it's supposed to distribute and partition."

YAGNI — minimalist. Don't over-engineer.

## Model to encode (distilled from operator voices 77497–77511)

**Worker's job (simple):** Check assignments folder → pick up next task → do the work. That's it. The worker doesn't need to understand fleet management.

**Foreman's job (the intelligence):** Before dispatching, partition the task set. Each partition = a named topic (e.g. "session-management", "dequeue", "SSE layer"). One worker per partition. Worker count = partition count — it emerges naturally.

**Scaling intuition:**
- 3 workers ≈ natural rotation (starting / in-flight / finishing)
- ~6 workers ≈ practical ceiling per repo (beyond this, fresh-context + worktree overhead dominates)
- No hard cap — if partitions justify more, justify it; if they don't, merge them

**Persistent worker branches are valid:** A worker can accumulate multiple commits on its named branch and merge the whole branch when done. Compartmentalizing per task is fine but not required.

**Collision guard:** If any two partitions touch the same files, merge those partitions. Over-serialize rather than over-parallelize.

## Acceptance criteria

- [ ] Fleet Management section added to foreman's core agent doc (concise — paragraph or tight bullets)
- [ ] Covers: partition-first dispatch, named workers, scaling intuition, collision guard
- [ ] No hard numbers in the text
- [ ] Applies from the next sprint (current sprint in-flight, too late to change)

## Notes

- Target file: foreman's `core.agent.md` (or equivalent — confirm path before editing)
- Curator authors, no worker dispatch
- Agent stamps and closes once Curator confirms addition is in place

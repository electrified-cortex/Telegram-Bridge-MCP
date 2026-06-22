---
title: "Add pre-PR harness-agnostic gate for TMCP — enforce no-pod-concepts at review time"
priority: high
type: process/friction
delegation: curator
dispatch_ready: false
created: 2026-06-22
source: agent-investigation (TG 77805-77806)
related: .tasks/00-ideas/v8-tmcp-no-pod-concepts-2026-05-27.md
---

# Add pre-PR harness-agnostic gate for TMCP

## Root cause of 7.11.1 pod-concept violations

Task 15-0898 specced "pod-memory" as the convention name and `memory/telegram/session.token` as a hardcoded path. The spec was written using internal vocabulary. The worker implemented exactly what was specced. The foreman reviewed against the spec's own ACs — all passed. No cross-cutting harness-agnostic audit ran before the branch was pushed.

The `v8-tmcp-no-pod-concepts` directive (operator voice 62572, 2026-05-27) exists as an idea file but is **not enforced as a gate anywhere in the pipeline**.

## What needs to exist

### Option A — Foreman review checklist item (low friction)
Add a mandatory checklist item to TMCP foreman review procedure:
> Before approving any worker branch, grep changed `src/` and `docs/` files for: `pod`, `pod-memory`, `pod root`, `pod-relative`, `memory/telegram/`, `CLAUDE.md`, `.claude/settings`, `Claude Code`, `.agents/agents/`. Any match in user-facing content (strings, docs, help topics, service messages) = BLOCKED until removed.

### Option B — Pre-push script gate (automated)
Add a `check-no-pod-concepts.sh` script to TMCP that runs before any `git push`:
```bash
# Fail if any pod-concept violations found in src/ or docs/
git diff origin/dev... -- src/ docs/ | grep -E "pod[- ]|pod root|memory/telegram/|\.claude/settings|Claude Code" && echo "POD-CONCEPT VIOLATION" && exit 1
```
Wire into foreman push gate or as a pre-push hook.

### Option C — Spec-level constraint (upstream fix)
Encode the no-pod-concepts directive as a constraint the coordinating agent must check at task-creation time for any TMCP task that touches `src/`, `docs/`, or service messages. Add to the TMCP task template:
> ⚠️ TMCP CONSTRAINT: No pod-terminology (pod, pod-memory, pod root, pod-relative, CLAUDE.md, .agents/) in user-facing content. TMCP is harness-agnostic. Violates standing directive — operator voice 62572.

## OPERATOR DIRECTIVE (mandatory — 2026-06-22)

The operator established (2026-06-22) that at least one adversarial review of source and test changes is required before pushing. The reviewing agent owns this gate — the foreman only verifies task ACs; the agent runs the adversarial review and approves push. This rule is encoded in the agent's `050-your-rules.md.fragment`.

## Recommendation

**All three, layered:**
1. Option C prevents spec-level violations before a worker is ever dispatched
2. Option A catches implementation drift from spec during foreman review — **now also includes mandatory adversarial src/test review agent before push approval**
3. Option B is the final backstop before the branch leaves the repo

## Acceptance criteria

1. TMCP foreman review checklist includes pod-concept grep check (Option A)
2. Coordinating agent task template for TMCP-touching tasks includes the no-pod-concepts constraint (Option C)
3. Optional: pre-push hook or script added to TMCP (Option B)
4. The v8-tmcp-no-pod-concepts idea file is either promoted to a formal constraint doc or closed with a pointer to where the constraint now lives

## Notes

This does not fix 7.11.1. That fix is in `tmcp-remove-pod-concepts-from-15-0898.md`. This prevents recurrence.

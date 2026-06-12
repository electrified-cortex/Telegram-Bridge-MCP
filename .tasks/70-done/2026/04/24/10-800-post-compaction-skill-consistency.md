---
id: 10-800
title: Update telegram-mcp-post-compaction-recovery SKILL.md for new agent layout
priority: 10
status: queued
origin: operator directive 2026-04-24
---

# Update telegram-mcp-post-compaction-recovery SKILL.md

Companion to `10-799` (help("compacted") rewrite). The shared skill at `skills/telegram-mcp-post-compaction-recovery/SKILL.md` also carries stale assumptions that need reconciliation with the new agent context layout.

Concerns

- References `memory/telegram/session.md` as token store; the current convention uses `memory/telegram/session.token` (plain value, no frontmatter). Confirm across agents.
- "Checkpoint block" in session file mentioned as forced-stop indicator — verify this contract is still honored.
- Procedure assumes `dequeue(timeout: 0)` — current arg is `max_wait: 0` (`timeout` deprecated alias). Update to canonical.
- Step 2 suggests an animation as the alive-probe. Re-evaluate: does `dequeue(max_wait: 0)` with the stored token already answer the question cheaper, with no user-visible side effect?
- The PostCompact `additionalContext` fold-in note assumes a hook config many agents no longer install. Confirm against current workspace hooks.
- Terminology alignment with the new agent layout: references to agent files should stay abstract (this is a shared skill), but examples and variable names must be consistent with what agents actually use today.

Acceptance (pending refinement)

- SKILL.md rewritten to reflect current session-file naming (`session.token`), canonical dequeue params, and current hook reality.
- No conflicts with `docs/help/compacted.md` after its rewrite.
- No direct references to agent-specific files (`CLAUDE.md`, `context/*.md`) — stays portable.

Reversal: single skill file; revert via git.

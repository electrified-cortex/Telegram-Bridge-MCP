---
id: 10-0835
title: TMCP profiles/ folder — workflow-specific content; sanitize or relocate
priority: 10
status: draft
type: hygiene
delegation: any
---

# TMCP profiles/ — Curator/Overseer/Worker contain workspace-specific workflow assumptions

The three profile JSON files shipped under `profiles/` aren't generic examples — they're operator's actual production fleet profiles, baked with task-engine pipeline assumptions and role-coupling that doesn't apply to a downstream consumer.

## Evidence

`profiles/Curator.json` reminders include:

- "Scan tasks/ for duplicates, misplaced files, stale drafts" — assumes `tasks/` directory layout.
- "Document conversation since last log entry. Write to logs/session/YYYYMM/DD/HHmmss/." — workspace logging convention.
- "Check for unfiled Telegram dumps. Scan chat history... in logs/telegram/." — workspace convention.

`profiles/Overseer.json` reminders include:

- "Completed task verification: scan 60-review/ for tasks ready to seal. Read skills/task-engine/verification and skills/task-engine/finalization before proceeding."
- "Pipeline scan: survey all task stages (40-queued, 50-active, 60-review)."
- "PR exhaustion check: ... read skills/- GitHub/copilot-exhaustion/SKILL.md and follow the exhaustion loop. DM Curator with PR status."
- "Worktree cleanup: Scan all workspace repos for stale worktrees..."

These reference task-engine stages (`40-queued/`, `50-active/`, `60-review/`, `70-done/`), workspace skill paths (`skills/task-engine/`, `skills/- GitHub/`), and the fleet role topology (Curator/Overseer/Worker DMs). All of those are workspace-specific assumptions — a downstream user adopting TMCP would be confused or misled.

## Two paths

**A. Relocate.** Move the three profiles out of `Telegram MCP/profiles/` into the parent workspace (e.g. under a private `profiles/` path or `agents/<role>/profile.json`). TMCP's `profiles/` folder either becomes empty with a README explaining the schema, or contains genuine bare-minimum samples (voice + 1 animation preset, no reminders).

**B. Sanitize in place.** Strip workspace-specific reminders from each profile, leaving only generic voice + animation defaults. Add a `profiles/README.md` clarifying these are starter templates — users should add their own reminders and animation presets.

Recommendation: A. The profiles as-they-stand are leakage and reading them gives a false impression of how TMCP works in isolation. Generic samples (voice + a single bracket animation) are easy to write fresh; copying operator's real profiles into the public repo blurs the boundary.

## Acceptance

If A:

- `Telegram MCP/profiles/` either deleted (with .gitignore entry to prevent re-add) OR reduced to a single `profiles/README.md` + a minimal `example.json` template (≤15 lines).
- Operator's three real profiles relocated to the parent workspace under a path that ships only locally.
- README explains: "Profiles are caller-side configuration. Bring your own."

If B:

- All three JSON files retained but reminders stripped of: stage folder names, skill paths, role-DM directives, workspace logging paths.
- Add `profiles/README.md` clarifying example status.

## Don'ts

- Do NOT silently delete operator's reminders without backing them up to the parent workspace first. Backup before relocate.
- Do NOT leave the profiles as-is and add a "these are examples" disclaimer at the top of each file. Disclaimers are weaker than relocation.

## Related

- `feedback_task_engine_repo_hygiene` (Curator memory) — TMCP is public-intent; zero leakage.
- The parent workspace is the dogfood template; profiles belong there, not in the dogfooded library.

## Branch

`10-0835` off `dev`.

# 20-1932 — monitor scripts: delegate to file-watching skill

## Context

`tools/monitor.ps1` and `tools/monitor.sh` reimplement file-watching logic that already exists in the shared file-watching skill. They lack debouncing, persistent watchers, atomic-save detection, and proper absolute-path enforcement — all of which the skill handles correctly. Discovered during 7.5 PR review.

The reference skill lives at:
- PowerShell: `.overseer-pod/.claude/skills/file-watching/watch.ps1` (or equivalent relative path from the skills repo)
- Bash: `.overseer-pod/.claude/skills/file-watching/watch.sh`

## Acceptance criteria

1. `tools/monitor.ps1` delegates to `watch.ps1` from the file-watching skill (via relative path reference, the same pattern used by other TMCP tooling that references shared skills). If `pwsh` is unavailable, fallback inline as last resort.
2. `tools/monitor.sh` routes to `pwsh watch.ps1` when available (matching `watch.sh` pattern), otherwise uses the `watch.sh` fallback (inotifywait → fswatch → 2s sleep-poll with debounce).
3. `docs/help/activity/file.md` updated to reflect that the bundled scripts now delegate to the skill.
4. All existing behavior preserved: `kick`, `heartbeat`, `timeout` output tokens; `--prefix` flag; session-relative file path handling.
5. Changes merged into `dev` branch and 7.5 PR updated.

## Source

Operator 2026-05-16: monitor scripts should reference the file-watching skill, not reimplement it. Identified during 7.5 PR review as a blocker.

## Notes

- `canonical-recipe.ts` is intentionally a simple 1-second poll — do NOT change it.
- The file-watching skill path may need to be discovered at runtime or bundled — check how other TMCP tools reference shared skills.

## Verification

APPROVED 2026-05-16 — AC1–AC4 confirmed; AC5 is a foreman post-step (merge by foreman after approval).

- AC1: `tools/monitor.ps1:68-79` — delegates to `../skills/file-watching/watch.ps1` via `GetFullPath`; inline `FileSystemWatcher` fallback at lines 84+.
- AC2: `tools/monitor.sh:97-120` — pwsh→watch.ps1 → bash→watch.sh → inline poll. `translate()` maps `changed`→`kick`.
- AC3: `docs/help/activity/file.md` — delegation chain + `--prefix` examples added.
- AC4: token pass-through, `--prefix`/`-Prefix`, absolute path enforcement all confirmed. 3062/3062 tests pass.
- AC5: merged to dev as bfbd9ef by foreman.

Squash commit: bfbd9ef. Sealed-By: Foreman 2026-05-16.

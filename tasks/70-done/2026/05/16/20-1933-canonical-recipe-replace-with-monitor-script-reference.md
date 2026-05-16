# 20-1933 — canonical recipe: replace polling loop with monitor script reference

## Context

`src/tools/activity/canonical-recipe.ts` currently returns a naive 1-second stat-poll loop to agents. Now that `tools/monitor.sh` and `tools/monitor.ps1` exist and will be updated to use the file-watching skill (task 20-1932), the canonical recipe should reference those scripts instead.

## Acceptance criteria

1. `canonical-recipe.ts` returns a recipe that points agents to run the bundled monitor script (`tools/monitor.sh` or `tools/monitor.ps1`) with the activity file path as argument, rather than an inline polling loop.
2. If the monitor scripts cannot be located at runtime, provide a minimal fallback (the current stat-poll loop) with a warning.
3. `docs/help/activity/file.md` updated to reflect the new recipe.
4. Changes merged into dev.

## Source

Operator 2026-05-16: "canonical monitor recipe is dead — we've offered up a monitor script."

## Verification

APPROVED 2026-05-16 — all criteria confirmed.

- AC1: `src/tools/activity/canonical-recipe.ts:13` — delegates to `tools/monitor.sh` as primary path.
- AC2: `else` branch preserves original stat-poll loop with `echo "WARNING: tools/monitor.sh not found" >&2`.
- AC3: `docs/help/activity/file.md:86,111` — updated with new recipe and explanatory prose.
- AC4: merged to dev as 7c06d41 by foreman.

Squash commit: 7c06d41. Sealed-By: Foreman 2026-05-16.

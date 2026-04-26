# 10-737 - Hook allowlist hash fragility: rethink the SHA-256 gating model

## Context

The Worker pre-tool-use hook (`.agents/agents/worker/hooks/pretooluse-permissions.ps1`) gates script execution on exact SHA-256 match against a curated allowlist (`permissions-scripts.ps1`). Any edit - including whitespace, line-ending, or comment changes - invalidates the hash and blocks the fleet until Curator restamps.

Observed 2026-04-19: this caused hours of friction on a phantom script (`complete.ps1`) that didn't exist. Adjacent problem: any legitimate edit to `claim.ps1` requires a Curator ritual (read, compute hash, update allowlist, commit) before Workers can resume.

The hash check is load-bearing for governance (Workers cannot silently run modified scripts) but its current form is too brittle to live with.

## Acceptance Criteria

Choose ONE of the following reform paths (spec-review required before implementation):

**Option A - Signed manifests.** Replace raw SHA-256 entries with a signed manifest: Curator signs `{ path, hash, intent }` tuples with a local key. Hook verifies signature, not raw hash. Restamping becomes `sign-manifest.ps1` rather than hand-editing allowlist lines.

**Option B - Content-aware hashing.** Hash the AST / normalized canonical form of the script (whitespace + comments stripped) so cosmetic edits don't invalidate the allowlist.

**Option C - Path + git-ref gating.** Gate on `{ path, git-tracked, HEAD matches allowlisted commit range }` rather than content hash. Uncommitted edits can still run in dev loops but won't pass CI.

1. Produce a design doc comparing the three options against: (a) 2026-04-19 friction, (b) governance strength, (c) Curator workload, (d) Worker-visible error messages when gating fails.
2. Operator picks one. Implement it.
3. Existing allowlist migrates to the new model in a single transition commit.
4. Regression: editing a comment in `claim.ps1` does NOT require a restamp (if B chosen); cosmetic edit DOES require a re-sign but via a one-command ritual (if A chosen); cosmetic edit passes while committed, fails while uncommitted outside dev (if C chosen).

## Constraints

- Do not weaken governance. The new model must still prevent a Worker from silently running a modified script.
- Must coexist with the existing hook codepath during the transition commit - no fleet-wide outage during the migration.
- Curator must not need to manually compute hashes in the new model. The ritual is the bug.
- Hooks live in the workspace, not the TMCP repo - file against the hooks surface, not TMCP.

## Priority

10 - governance friction. Depth-4 (architecture change). This is the underlying cause of multiple session-level friction incidents; fixing it prevents the class.

## Delegation

Curator authors the design doc directly (hooks are Curator trust boundary). Implementation may delegate to Worker once operator picks an option.

## Related

- Memory `feedback_dont_add_scripts_where_plain_ops_work.md`.
- Memory `project_task_pipeline_architecture.md`.
- 15-734 (hook error disambiguation; complementary - distinct failure modes must still be distinguishable under the new gating model).

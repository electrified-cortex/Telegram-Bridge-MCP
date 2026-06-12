# 15-734 - Hook error message disambiguation: "integrity check failed" is lying

## Context

Observed 2026-04-19: the Worker `pretooluse-permissions.ps1` hook reports **"Script integrity check failed"** for multiple distinct failure modes, all rolled into one message. This caused hours of misdiagnosis - Overseer and Curator repeatedly added hashes to the allowlist for a script that didn't exist, chasing an "integrity" problem that was actually a "file not found" or "path not resolvable" problem.

## Failure modes currently conflated

1. **Hash mismatch**: file exists at path, but its SHA-256 does not match the allowlist entry.
2. **File missing**: path resolves to nothing (Resolve-Path fails).
3. **Path outside allowlist**: path resolves but no allowlist entry matches.
4. **CWD mismatch**: path would resolve from a different CWD; invoked from wrong directory.

All four currently emit: "Script integrity check failed for: <path>"

## Acceptance Criteria

1. Distinguish the four failure modes with distinct error codes/messages:
   - `HOOK_HASH_MISMATCH: <path>` (with expected vs actual hash)
   - `HOOK_FILE_NOT_FOUND: <path>` (Resolve-Path returned nothing)
   - `HOOK_PATH_NOT_ALLOWED: <path>` (resolved but no pattern match)
   - `HOOK_CWD_MISMATCH: <path>` (hint to switch CWD; include expected CWD from allowlist entry)
2. Update the hook's decision tree to check these in order: file exists -> path pattern matches -> hash matches.
3. Keep the existing "fail closed" behavior - all four still block the tool call. Only the error message changes.
4. Unit-test the hook's decision tree with fixtures for each failure mode.

## Constraints

- Do not loosen the allowlist or add automatic retries. This is purely error-message clarity.
- Hook lives in `.agents/agents/worker/hooks/pretooluse-permissions.ps1` - not a TMCP-repo task. File against workspace hooks repo, not TMCP.
- The allowlist-scripts file (`permissions-scripts.ps1`) is governance-critical - do not modify its format without Curator review.

## Priority

15 - bug. Root cause of today's hours-long complete.ps1 friction spiral. Fix prevents next recurrence.

## Delegation

Curator authors the hook patch directly (hooks are Curator trust boundary). Not a Worker task.

## Related

- Memory `feedback_dont_add_scripts_where_plain_ops_work.md` (the incident driving this).
- Memory `project_task_pipeline_architecture.md`.

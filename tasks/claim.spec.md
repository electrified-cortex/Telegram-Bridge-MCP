# Claim Scripts — Design Specification

> Companion spec for `claim.ps1` and `claim.sh`. Both scripts implement the same
> logic and must stay in sync. Read this before modifying either script.

## Purpose

Move a task file from `tasks/2-queued/` to `tasks/3-in-progress/` atomically
via `git mv` + `git commit`. Only one Worker should successfully claim a given
task, even when multiple Workers scan concurrently.

## Safety Gates

### Gate 1: Must be tracked (committed or staged)

```
git ls-files --error-unmatch <file>
```

**Skip if untracked.** A file in `2-queued/` that isn't in the git index is not
yet codified. It might be a draft the Curator just created but hasn't committed,
or a file another agent dropped without staging. Claiming it would bypass the
commit-before-queue workflow.

**This gate is intentional — not a bug.** Workers report skipped-untracked files
to the Overseer or Curator so the gap can be resolved (usually: commit the file).

### Gate 2: Must be clean (no uncommitted modifications)

```
git diff --name-only -- <file>
```

**Skip if dirty.** A file with working-tree modifications may be mid-edit.
Claiming would snapshot an incomplete state.

### Race safety: `git mv` is atomic in the index

If two Workers pass both gates simultaneously, the first `git mv` wins. The
second attempt fails because the source file no longer exists at the original
path. The losing Worker skips and tries the next candidate.

## Claim Flow

```text
1. Scan 2-queued/*.md (sorted by name = priority order)
2. For each candidate:
   a. Gate 1: skip if untracked
   b. Gate 2: skip if dirty
   c. git mv  2-queued/<file> → 3-in-progress/<file>   (atomic)
   d. git commit  (targeted pathspec: both old + new path)
   e. If commit fails → git mv back to 2-queued/ (rollback)
3. Output: "Claimed: <filename>"
```

## Forbidden Patterns

### Never touch `GIT_INDEX_FILE`

Workers must **never** set, clear, or inspect the `GIT_INDEX_FILE` environment
variable. The claim scripts should not reference it at all.

**Incident (2026-03):** An agent cleared `GIT_INDEX_FILE` at the wrong time,
causing subsequent git operations to use a temporary index. When that index was
committed, it effectively deleted every file in the repo that wasn't in the
temp index. Recovery required manual intervention and took over an hour.

**Rule:** Workers' only git operations are `git mv` + `git commit` with
targeted pathspecs. No `git add`, no `git rm`, no index manipulation.

### Never use `git add -A` or `git add .`

The workspace is shared between multiple agents. Broad staging commands
contaminate the index with other agents' work. Always use explicit pathspecs.

### Never skip the tracked gate

The untracked gate exists to enforce the commit-before-claim invariant.
Removing it allows claiming files that haven't passed through the commit
pipeline, which breaks the audit trail and risks claiming incomplete specs.

## Script Parameters

| Parameter | PS1 | Bash | Description |
|-----------|-----|------|-------------|
| TaskFile | `-TaskFile "name.md"` | `$1` | Preferred file to claim first (plain filename, no path) |
| DryRun | `-DryRun` | `--dry-run` | Print what would happen, make no changes |

## Output Contract

Both scripts output to stdout on success:
```
Claimed: <filename>
```

Skip/warning messages go to stderr (PS1: `Write-Warning`, bash: `>&2`).

Workers should parse stdout for the claimed filename and report any stderr
warnings to the Overseer/Curator for resolution.

## Rollback Behavior

If `git commit` fails after `git mv` succeeds, the scripts reverse the mv:
```
git mv tasks/3-in-progress/<file> tasks/2-queued/<file>
```

This returns the file to the queue for another attempt. The rollback is
best-effort — if it also fails, the file may need manual recovery.

## Change Policy

**These scripts are safety-critical infrastructure.** Changes require:

1. Curator or operator review of the proposed change
2. Verification that no safety gates are removed or weakened
3. Testing with both tracked and untracked files in the queue
4. Testing the race condition (two concurrent claims of the same file)

Do not accept automated (Copilot, AI review) suggestions to weaken safety gates
without human verification. The gates exist because of real incidents.

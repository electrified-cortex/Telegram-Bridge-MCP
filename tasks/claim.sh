#!/usr/bin/env bash
# claim.sh — Claims a task from 2-queued/ by staging a baseline snapshot at
# 4-completed/ and moving the working copy to 3-in-progress/.
#
# Usage:
#   ./tasks/claim.sh <task-filename>           # claim
#   ./tasks/claim.sh <task-filename> --dry-run  # preview without changes
#
# Workflow (atomic):
#   1. mv (atomic rename) 2-queued/<file> -> 3-in-progress/<file>  (claim lock)
#      Fails immediately if another Worker already claimed the task.
#   2. cp  3-in-progress/<file> -> 4-completed/YYYY-MM-DD/<file>   (baseline copy)
#   3. git rm --cached tasks/2-queued/<file> (remove old index entry)
#      Falls back silently if file was untracked.
#   4. git add tasks/4-completed/YYYY-MM-DD/<file>                 (stage baseline)

set -euo pipefail

TASK_FILE="${1:-}"
DRY_RUN=false

if [[ "${2:-}" == "--dry-run" ]]; then
    DRY_RUN=true
fi

if [[ -z "$TASK_FILE" ]]; then
    echo "Usage: $0 <task-filename> [--dry-run]" >&2
    exit 1
fi

# Reject path components
if [[ "$TASK_FILE" == */* || "$TASK_FILE" == *..* ]]; then
    echo "Error: TaskFile must be a plain filename, not a path: $TASK_FILE" >&2
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QUEUED_PATH="$REPO_ROOT/tasks/2-queued/$TASK_FILE"
DATE="$(date +%Y-%m-%d)"
COMPLETED_DIR="$REPO_ROOT/tasks/4-completed/$DATE"
COMPLETED_PATH="$COMPLETED_DIR/$TASK_FILE"
IN_PROGRESS_PATH="$REPO_ROOT/tasks/3-in-progress/$TASK_FILE"

if [[ "$DRY_RUN" == true ]]; then
    if [[ ! -f "$QUEUED_PATH" ]]; then
        echo "Error: Task not found: $QUEUED_PATH" >&2
        exit 1
    fi
    echo "[DRY RUN] Would: create directory tasks/4-completed/$DATE (if missing)"
    echo "[DRY RUN] Would: mv tasks/2-queued/$TASK_FILE -> tasks/3-in-progress/$TASK_FILE  (atomic claim)"
    echo "[DRY RUN] Would: cp tasks/3-in-progress/$TASK_FILE -> tasks/4-completed/$DATE/$TASK_FILE  (baseline)"
    echo "[DRY RUN] Would: git rm --cached tasks/2-queued/$TASK_FILE  (remove old index entry; skipped if untracked)"
    echo "[DRY RUN] Would: git add tasks/4-completed/$DATE/$TASK_FILE  (stage baseline)"
    echo ""
    echo "[DRY RUN] No changes were made."
    exit 0
fi

# Create completed date directory if needed
mkdir -p "$COMPLETED_DIR"

# Step 1: Atomic claim — mv is a single rename(2) syscall on the same filesystem.
# If another Worker already moved the file, mv fails and we exit cleanly.
# Capture stderr to a temp file so we can emit a meaningful error.
_CLAIM_ERR_TMP="$(mktemp /tmp/claim_err_XXXXXX)"
if ! mv "$QUEUED_PATH" "$IN_PROGRESS_PATH" 2>"$_CLAIM_ERR_TMP"; then
    if [[ ! -f "$QUEUED_PATH" ]]; then
        echo "Error: Task already claimed by another Worker: $TASK_FILE" >&2
    else
        echo "Error: Could not claim task: $(cat "$_CLAIM_ERR_TMP")" >&2
    fi
    rm -f "$_CLAIM_ERR_TMP"
    exit 1
fi
rm -f "$_CLAIM_ERR_TMP"

# Rollback trap: if any subsequent step fails, restore the file to the queue.
trap 'mv "$IN_PROGRESS_PATH" "$QUEUED_PATH" 2>/dev/null; echo "Error: Claim failed mid-flight — task restored to queue." >&2' ERR

# Step 2: Baseline copy to completed/DATE/ for git index snapshot
cp "$IN_PROGRESS_PATH" "$COMPLETED_PATH"

# Step 3 & 4: Git staging
cd "$REPO_ROOT"

# Safety: clear GIT_INDEX_FILE if set (15-300 removal — see 10-314).
# Belt-and-suspenders: even without this, the pathspec commit below
# ensures only claim files are committed.
unset GIT_INDEX_FILE 2>/dev/null || true

# Remove old queued entry from the git index (may not be tracked — that's fine)
git rm --cached "tasks/2-queued/$TASK_FILE" 2>/dev/null || true

# Stage the baseline copy
git add "tasks/4-completed/$DATE/$TASK_FILE"

# Step 5: Targeted commit — only include the specific claim paths.
# Prevents staging contamination regardless of shared index state.
git commit -m "pipeline: claim $TASK_FILE" -- "tasks/2-queued/$TASK_FILE" "tasks/4-completed/$DATE/$TASK_FILE"

# All post-mv steps succeeded — clear the rollback trap
trap - ERR

echo "Claimed: $TASK_FILE"
echo "  Baseline committed at: tasks/4-completed/$DATE/$TASK_FILE"
echo "  Working copy at:       tasks/3-in-progress/$TASK_FILE"
echo ""
echo "After task runner finishes, move file to tasks/4-completed/$DATE/"
echo "Then 'git diff' shows what changed."

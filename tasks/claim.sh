#!/usr/bin/env bash
# claim.sh — Claims the next valid task from 2-queued/ via git mv.
#
# Usage:
#   ./tasks/claim.sh [task-filename] [--dry-run]
#
# Scans tasks/2-queued/ in priority order (filename sort). For each candidate:
#   1. Skips untracked files (not in git index)   — warns, notifies Overseer.
#   2. Skips dirty files (uncommitted modifications) — warns, notifies Overseer.
#   3. git mv  tasks/2-queued/<file>  ->  tasks/3-in-progress/<file>
#      Atomic index + filesystem move. Skips if already claimed (race-safe).
#   4. git commit  (targeted to claim paths only)
#
# Optional task-filename: try this file first; if invalid, scan continues.

set -uo pipefail

TASK_FILE="${1:-}"
DRY_RUN=false

if [[ "${2:-}" == "--dry-run" || "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=true
    # If first arg is --dry-run, clear TASK_FILE
    if [[ "$TASK_FILE" == "--dry-run" ]]; then
        TASK_FILE=""
    fi
fi

# Reject path components in optional preference arg
if [[ -n "$TASK_FILE" && ("$TASK_FILE" == */* || "$TASK_FILE" == *..*) ]]; then
    echo "Error: TaskFile must be a plain filename, not a path: $TASK_FILE" >&2
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QUEUE_DIR="tasks/2-queued"

cd "$REPO_ROOT"

# Build candidate list: preferred file first (if specified), then remaining sorted
mapfile -t ALL_QUEUED < <(find "$QUEUE_DIR" -maxdepth 1 -name '*.md' -printf '%f\n' 2>/dev/null | sort)

if [[ -n "$TASK_FILE" ]]; then
    # Preferred file first, then rest (excluding the preferred)
    CANDIDATES=("$TASK_FILE")
    for f in "${ALL_QUEUED[@]:-}"; do
        [[ "$f" != "$TASK_FILE" ]] && CANDIDATES+=("$f")
    done
else
    CANDIDATES=("${ALL_QUEUED[@]:-}")
fi

if [[ ${#CANDIDATES[@]} -eq 0 ]]; then
    echo "Error: No tasks found in $QUEUE_DIR" >&2
    exit 1
fi

CLAIMED=""

for candidate in "${CANDIDATES[@]}"; do
    candidate_path="$REPO_ROOT/$QUEUE_DIR/$candidate"

    [[ -f "$candidate_path" ]] || continue

    # Gate 1: must be tracked in git index
    if ! git ls-files --error-unmatch "$QUEUE_DIR/$candidate" 2>/dev/null; then
        echo "SKIP: $candidate — untracked file in queue. Notify Overseer." >&2
        continue
    fi

    # Gate 2: must be clean (no working-tree modifications)
    if [[ -n "$(git diff --name-only -- "$QUEUE_DIR/$candidate" 2>/dev/null)" ]]; then
        echo "SKIP: $candidate — dirty (uncommitted modifications) in queue. Notify Overseer." >&2
        continue
    fi

    if [[ "$DRY_RUN" == true ]]; then
        echo "[DRY RUN] Would: git mv $QUEUE_DIR/$candidate -> tasks/3-in-progress/$candidate"
        echo "[DRY RUN] Would: git commit -m \"pipeline: claim $candidate\""
        echo ""
        echo "[DRY RUN] No changes were made."
        exit 0
    fi

    # Attempt atomic claim — fails if another Worker already took it
    if ! git mv "$QUEUE_DIR/$candidate" "tasks/3-in-progress/$candidate" 2>/dev/null; then
        echo "SKIP: $candidate — claim race (file already taken)." >&2
        continue
    fi

    # Commit — targeted to claim paths only; rollback on failure
    if ! git commit -m "pipeline: claim $candidate" -- "$QUEUE_DIR/$candidate" "tasks/3-in-progress/$candidate"; then
        git mv "tasks/3-in-progress/$candidate" "$QUEUE_DIR/$candidate" 2>/dev/null || true
        echo "SKIP: $candidate — commit failed, rolled back." >&2
        continue
    fi

    CLAIMED="$candidate"
    break
done

if [[ -z "$CLAIMED" ]]; then
    echo "Error: No claimable tasks found in $QUEUE_DIR" >&2
    exit 1
fi

echo "Claimed: $CLAIMED"
echo "  Working copy at: tasks/3-in-progress/$CLAIMED"
echo ""
echo "When done, git mv tasks/3-in-progress/$CLAIMED tasks/4-completed/<date>/$CLAIMED"
echo "Then git commit and notify the Overseer."

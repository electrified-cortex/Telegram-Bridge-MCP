#!/usr/bin/env bash
# monitor.sh — watch a TMCP activity file for changes; emit kick / heartbeat / timeout.
#
# Delegates to the file-watching skill (../skills/file-watching/):
#   1. pwsh watch.ps1   — event-driven, zero idle CPU (preferred)
#   2. bash watch.sh    — inotifywait → fswatch → 2s sleep-poll fallback
#   3. Inline poll loop — last resort if skill scripts are not found
#
# Usage: monitor.sh <activity_file_path> [options]
#
# Arguments:
#   <activity_file_path>   Path to the activity file (from action(type: "activity/file/create")).
#
# Options:
#   --heartbeat <s>    Emit a `heartbeat` line every <s> seconds of inactivity. Default: off.
#   --timeout <s>      Exit after <s> consecutive idle seconds with no kick. Default: never.
#   --prefix <string>  Insert "<prefix>: " before each token. Default: empty.
#   --help             Print this help and exit.
#
# Output:
#   kick          — activity file mtime changed; call dequeue().
#   heartbeat     — no change in the last --heartbeat seconds (monitor is alive).
#   timeout       — --timeout elapsed with no kick; exits 0.
#
# Exit code: 0 on timeout or normal termination; non-zero on argument error.

set -euo pipefail

usage() {
    cat <<'EOF'
Usage: monitor.sh <activity_file_path> [--heartbeat <seconds>] [--timeout <seconds>] [--prefix <string>] [--help]

Watches a TMCP activity file for mtime changes and emits one kick line per change.

  <activity_file_path>   Path returned by action(type: "activity/file/create").
  --heartbeat <s>        Emit `heartbeat` every <s> idle seconds (monitor liveness signal).
  --timeout <s>          Exit with `timeout` after <s> consecutive idle seconds. Default: never.
  --prefix <string>      Insert "<prefix>: " before each token.
  --help                 Print this help and exit.

Output lines:
  kick        mtime changed — call dequeue()
  heartbeat   monitor is alive (emitted every --heartbeat seconds when idle)
  timeout     idle limit reached — exits 0
EOF
}

ACTIVITY_FILE=""
HEARTBEAT=0
TIMEOUT=0
PREFIX=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --heartbeat)
            HEARTBEAT="$2"
            [[ "$HEARTBEAT" =~ ^[1-9][0-9]*$ ]] || { echo "monitor.sh: --heartbeat requires a positive integer" >&2; exit 1; }
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            [[ "$TIMEOUT" =~ ^[1-9][0-9]*$ ]] || { echo "monitor.sh: --timeout requires a positive integer" >&2; exit 1; }
            shift 2
            ;;
        --prefix)
            PREFIX="$2"
            shift 2
            ;;
        --help)
            usage
            exit 0
            ;;
        -*)
            echo "monitor.sh: unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
        *)
            if [[ -z "$ACTIVITY_FILE" ]]; then
                ACTIVITY_FILE="$1"
            else
                echo "monitor.sh: unexpected argument: $1" >&2
                usage >&2
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ -z "$ACTIVITY_FILE" ]]; then
    echo "monitor.sh: activity_file_path is required" >&2
    usage >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/../skills/file-watching" 2>/dev/null && pwd)" || SKILL_DIR=""

# translate: strip ISO8601 timestamp (first word) and map changed → kick.
translate() {
    awk '{ sub(/^[^ ]+ /, ""); sub(/changed$/, "kick"); print; fflush() }'
}

# ── Layer 1: pwsh + watch.ps1 (event-driven, preferred) ──────────────────────
if command -v pwsh >/dev/null 2>&1 && [[ -n "$SKILL_DIR" && -f "$SKILL_DIR/watch.ps1" ]]; then
    PS_ARGS=("-File" "$SKILL_DIR/watch.ps1" "$ACTIVITY_FILE"
        "-Timeout"   "$TIMEOUT"
        "-Heartbeat" "$HEARTBEAT"
        "-Debounce"  "0")
    [[ -n "$PREFIX" ]] && PS_ARGS+=("-Prefix" "$PREFIX")
    pwsh "${PS_ARGS[@]}" | translate
    exit "${PIPESTATUS[0]}"
fi

# ── Layer 2: bash watch.sh (inotifywait → fswatch → sleep-poll) ───────────────
if [[ -n "$SKILL_DIR" && -f "$SKILL_DIR/watch.sh" ]]; then
    SH_ARGS=("$ACTIVITY_FILE" "--timeout" "$TIMEOUT" "--heartbeat" "$HEARTBEAT" "--debounce" "0")
    [[ -n "$PREFIX" ]] && SH_ARGS+=("--prefix" "$PREFIX")
    bash "$SKILL_DIR/watch.sh" "${SH_ARGS[@]}" | translate
    exit "${PIPESTATUS[0]}"
fi

# ── Layer 3: inline fallback ──────────────────────────────────────────────────
# Used only when skills/file-watching/ scripts are not found at the expected path.

# Cross-platform mtime: GNU stat (Linux/Git-Bash) then BSD stat (macOS).
get_mtime() {
    stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0
}

emit() {
    if [[ -n "$PREFIX" ]]; then
        echo "${PREFIX}: $1"
    else
        echo "$1"
    fi
}

# Establish baseline so startup does not produce a spurious kick.
last_mtime=0
[[ -f "$ACTIVITY_FILE" ]] && last_mtime=$(get_mtime "$ACTIVITY_FILE")

last_event_ts=$(date +%s)
last_heartbeat_ts=$last_event_ts

while true; do
    now=$(date +%s)

    # Mtime check.
    if [[ -f "$ACTIVITY_FILE" ]]; then
        current_mtime=$(get_mtime "$ACTIVITY_FILE")
        if [[ "$current_mtime" != "$last_mtime" ]]; then
            emit "kick"
            last_mtime=$current_mtime
            last_event_ts=$now
            last_heartbeat_ts=$now
            continue
        fi
    fi

    # Timeout check.
    if [[ $TIMEOUT -gt 0 ]]; then
        idle=$(( now - last_event_ts ))
        if [[ $idle -ge $TIMEOUT ]]; then
            emit "timeout"
            exit 0
        fi
    fi

    # Heartbeat check.
    if [[ $HEARTBEAT -gt 0 ]]; then
        since_beat=$(( now - last_heartbeat_ts ))
        if [[ $since_beat -ge $HEARTBEAT ]]; then
            emit "heartbeat"
            last_heartbeat_ts=$now
        fi
    fi

    sleep 2
done

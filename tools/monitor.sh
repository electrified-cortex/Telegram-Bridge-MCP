#!/usr/bin/env bash
# monitor.sh — watch a TMCP activity file for changes; emit kick / heartbeat / timeout.
#
# Detection order (per OS):
#   1. inotifywait  (Linux, inotify-tools)  — event-driven, zero idle CPU
#   2. fswatch      (macOS, via Homebrew)   — event-driven, optional install
#   3. sleep-loop   (fallback, all OSes)    — 1-second polling, always available
#
# Usage: monitor.sh <activity_file_path> [options]
#
# Arguments:
#   <activity_file_path>   Absolute path to the activity file (from action(type: "activity/file/create")).
#
# Options:
#   --heartbeat <s>    Emit a `heartbeat` line every <s> seconds of inactivity. Default: off.
#   --timeout <s>      Exit after <s> consecutive idle seconds with no kick. Default: never.
#   --help             Print this help and exit.
#
# Output:
#   kick          — activity file mtime changed; call dequeue().
#   heartbeat     — no change in the last --heartbeat seconds (monitor is alive).
#   timeout       — --timeout elapsed with no kick; exits 0.
#
# Exit code: 0 on timeout or normal termination; non-zero on argument error.
#
# Note: The activity file path must be an absolute path. Use action(type: "activity/file/create")
#       in TMCP to provision the file; pass the returned file_path to this script.

set -euo pipefail

usage() {
    cat <<'EOF'
Usage: monitor.sh <activity_file_path> [--heartbeat <seconds>] [--timeout <seconds>] [--help]

Watches a TMCP activity file for mtime changes and emits one kick line per change.

  <activity_file_path>   Path returned by action(type: "activity/file/create").
  --heartbeat <s>        Emit `heartbeat` every <s> idle seconds (monitor liveness signal).
  --timeout <s>          Exit with `timeout` after <s> consecutive idle seconds. Default: never.
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

# Detect best available watch mechanism.
if command -v inotifywait &>/dev/null; then
    _WATCH_MODE=inotifywait
elif command -v fswatch &>/dev/null; then
    _WATCH_MODE=fswatch
else
    _WATCH_MODE=poll
fi

# Cross-platform mtime: GNU stat (Linux/Git-Bash) then BSD stat (macOS).
get_mtime() {
    stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0
}

# wait_for_change FILE SECS KNOWN_MTIME
# Blocks up to SECS seconds waiting for the file to be modified.
# Returns 0 if a change was detected, 1 if timed out with no change.
wait_for_change() {
    local file="$1" secs="$2" known_mtime="$3"
    local changed=0
    case "$_WATCH_MODE" in
        inotifywait)
            local rc=0
            inotifywait -q -e close_write,modify --timeout "$secs" "$file" >/dev/null 2>&1 || rc=$?
            if [[ $rc -eq 0 ]]; then changed=1; fi
            ;;
        fswatch)
            local rc=0
            timeout "$secs" fswatch -1 "$file" >/dev/null 2>&1 || rc=$?
            if [[ $rc -eq 0 ]]; then changed=1; fi
            ;;
        poll)
            local deadline=$(( $(date +%s) + secs ))
            while [[ $(date +%s) -lt $deadline ]]; do
                local cur; cur=$(get_mtime "$file")
                if [[ "$cur" != "$known_mtime" ]]; then
                    changed=1
                    break
                fi
                sleep 1
            done
            ;;
    esac
    if [[ $changed -eq 1 ]]; then return 0; else return 1; fi
}

# Establish baseline so startup does not produce a spurious kick.
last_mtime=0
[[ -f "$ACTIVITY_FILE" ]] && last_mtime=$(get_mtime "$ACTIVITY_FILE")

last_event_ts=$(date +%s)
last_heartbeat_ts=$last_event_ts

while true; do
    now=$(date +%s)

    # Mtime check — handles races on watcher startup and poll-mode detections.
    if [[ -f "$ACTIVITY_FILE" ]]; then
        current_mtime=$(get_mtime "$ACTIVITY_FILE")
        if [[ "$current_mtime" != "$last_mtime" ]]; then
            echo "kick"
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
            echo "timeout"
            exit 0
        fi
    fi

    # Heartbeat check (emit if overdue, reset timer).
    if [[ $HEARTBEAT -gt 0 ]]; then
        since_beat=$(( now - last_heartbeat_ts ))
        if [[ $since_beat -ge $HEARTBEAT ]]; then
            echo "heartbeat"
            last_heartbeat_ts=$now
        fi
    fi

    # Calculate maximum wait duration for this iteration.
    wait_secs=30
    if [[ $TIMEOUT -gt 0 ]]; then
        idle=$(( now - last_event_ts ))
        remaining=$(( TIMEOUT - idle ))
        [[ $remaining -lt 1 ]] && remaining=1
        [[ $remaining -lt $wait_secs ]] && wait_secs=$remaining
    fi
    if [[ $HEARTBEAT -gt 0 ]]; then
        since_beat=$(( now - last_heartbeat_ts ))
        remaining_beat=$(( HEARTBEAT - since_beat ))
        [[ $remaining_beat -lt 1 ]] && remaining_beat=1
        [[ $remaining_beat -lt $wait_secs ]] && wait_secs=$remaining_beat
    fi

    # Block until a change event or wait_secs elapses.
    if [[ -f "$ACTIVITY_FILE" ]]; then
        wait_for_change "$ACTIVITY_FILE" "$wait_secs" "$last_mtime" || true
    else
        sleep "$wait_secs"
    fi
done

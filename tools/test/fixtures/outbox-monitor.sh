#!/usr/bin/env bash
# Vendored from pod messaging system (messages/outbox/monitor.sh). Keep in sync with EC template.
#
# monitor.sh — pod outbox signal monitor (standalone).
#
# Watches `.signal` (co-located) for mtime changes via a pure-bash sleep-poll loop.
# No external skill dependency — self-contained.
#
# CLI surface:
#   --timeout <s>   inactivity timeout (default 0 = forever)
#   --single        exit after first `changed` (or timeout, whichever first)
#   --help          print usage, exit 0
#
# Output (one bare token per event, no timestamp):
#   new message    — .signal mtime changed since last tick
#   timeout        — --timeout seconds elapsed with no change, exit 0
#   closed         — .signal deleted (clean off-ramp), exit 0
#
# Signal-file lifecycle:
#   On startup (persistent mode) the script self-resets: if `.signal` already exists
#   it is deleted (causing any prior watcher to see the deletion and exit `closed`),
#   pauses 5 s, then recreates with `touch`. Idempotent on compaction recovery.
#   --single mode skips the reset so a temporary grace-window monitor cannot evict
#   a long-running watcher.
#
#   Clean off-ramp from any session-end flow:
#       rm <pod>/messages/outbox/.signal
#   The watcher emits `closed` and exits 0.

set -uo pipefail

usage() {
    cat <<'EOF'
Usage: monitor.sh [--timeout <seconds>] [--single] [--help]

Watches .signal (co-located with this script) for mtime changes.
On each change emits: `new message`
On clean inactivity timeout: prints `timeout` and exits 0.
On signal-file deletion:    prints `closed` and exits 0.

  --timeout <s>   Exit after <s> consecutive seconds of no event. Default: never.
  --single        Exit after the first `changed` event. Combined with --timeout,
                  whichever fires first ends the script. Exit code: 0.
  --help          Print this help and exit.

Off-ramp:
  Delete the signal file from any session-end / shutdown flow:
      rm <pod>/messages/outbox/.signal
  The watcher unravels itself cleanly. No kill / TaskStop required.

This script is standalone — no skill or plug-in dependency.
EOF
}

TIMEOUT=0
SINGLE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --timeout)
            TIMEOUT="${2:?--timeout requires a value}"
            [[ "$TIMEOUT" =~ ^[0-9]+$ ]] || { echo "--timeout requires a non-negative integer" >&2; exit 1; }
            shift 2
            ;;
        --single)
            SINGLE=1
            shift
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            echo "monitor.sh: unknown argument: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIGNAL="${SCRIPT_DIR}/.signal"
TICK=2  # sleep-poll tick in seconds

# Self-reset (persistent mode only).
if (( ! SINGLE )); then
    if [ -f "$SIGNAL" ]; then
        rm -f "$SIGNAL"
        sleep 5
    fi
fi
touch "$SIGNAL"

# mtime helper — Linux (-c %Y) with macOS BSD (-f %m) fallback.
mtime_of() {
    if stat -c %Y "$1" >/dev/null 2>&1; then
        stat -c %Y "$1"
    else
        stat -f %m "$1"
    fi
}

last_mtime="$(mtime_of "$SIGNAL")"
last_event_epoch="$(date +%s)"

while true; do
    sleep "$TICK"

    # Off-ramp: signal deleted -> emit `closed` and exit.
    if [ ! -f "$SIGNAL" ]; then
        # Brief re-check for atomic temp+rename races.
        sleep 0.2
        if [ ! -f "$SIGNAL" ]; then
            echo "closed"
            exit 0
        fi
    fi

    cur_mtime="$(mtime_of "$SIGNAL")"

    if [ "$cur_mtime" != "$last_mtime" ]; then
        last_mtime="$cur_mtime"
        last_event_epoch="$(date +%s)"
        echo "new message"
        if (( SINGLE )); then
            exit 0
        fi
        continue
    fi

    # Idle this tick — check inactivity timeout.
    if (( TIMEOUT > 0 )); then
        now="$(date +%s)"
        if (( now - last_event_epoch >= TIMEOUT )); then
            echo "timeout"
            exit 0
        fi
    fi
done

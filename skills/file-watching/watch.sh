#!/usr/bin/env bash
# watch.sh — POSIX router for the file-watching skill.
#
# v1 contract:
#   1. If `pwsh` is on PATH, exec watch.ps1 with the same args (full feature parity).
#   2. Otherwise, fall back to a 2-second sleep-poll loop using stat(1) — same
#      changed / heartbeat / timeout / debounce contract, just slower wakeups
#      and 1-2s latency.
#
# Future versions MAY add inotifywait / fswatch paths between (1) and (2).
#
# Usage:
#   bash watch.sh <file-path> [--single] [--prefix <s>] [--timeout <s>] [--debounce <s>] [--heartbeat <s>] [--help]
#
# Output (stdout, one line per event):
#   <ISO8601-UTC-timestamp> [<prefix>: ]<token>
# e.g. `2026-05-15T05:48:32Z changed` or `2026-05-15T05:48:32Z Inbox: changed`.
#
# Tokens:
#   changed    — file mtime changed, burst settled (after debounce window)
#   heartbeat  — --heartbeat window elapsed with no change
#   timeout    — --timeout window elapsed with no change (script exits 0)
#   gone       — watched file deleted while running (script exits 0)
#   missing    — watched file did not exist at start (script exits 0)
#
# Exit codes: 0 on clean timeout / normal termination; 1 on argument error;
# 2 on watch failure or pwsh routing failure.

set -uo pipefail

show_usage() {
    cat <<'EOF'
Usage: watch.sh <file-path> [--single] [--prefix <s>] [--timeout <s>] [--debounce <s>] [--heartbeat <s>] [--help]

Watches a single file for modification and emits one `changed` per settled burst.

Routing (v1):
  - If pwsh is on PATH, exec watch.ps1 with the same args (full feature parity).
  - Otherwise, fall back to a 2-second sleep-poll loop using stat(1).

Arguments:
  <file-path>          Absolute path to the file to watch (required, positional).

Options:
  --single             Exit after the first `changed`. Combined with --timeout, whichever
                       fires first ends the script. Exit code: 0.
  --prefix <string>    Insert "<prefix>: " between the timestamp and the token on every
                       emitted line. Default empty.
  --timeout <s>        Exit after <s> consecutive idle seconds. Default: 0 (disabled).
  --debounce <s>       Coalescing window: rapid changes collapse into one `changed` after
                       <s> seconds of quiet. Range 0-60. Default: 2.
  --heartbeat <s>      Emit "heartbeat" every <s> idle seconds. Default: 0 (disabled).
  --help               Print this help and exit.

Off-ramp:
  Delete the watched file while the script is running -> emits `gone` and exits 0.
  Use this as a clean shutdown signal.

Output (one line per event on stdout). Format:
  <ISO8601-UTC-timestamp> [<prefix>: ]<token>

Tokens:
  changed        File burst settled.
  heartbeat      No change in the last --heartbeat seconds.
  timeout        --timeout elapsed; script exits 0.
  gone           Watched file deleted while running; script exits 0.
  missing        Watched file did not exist at start; script exits 0.

Notes:
- Sleep-poll fallback ticks every 2 seconds. mtime-stat based. Latency: up to 2s
  for first `changed` + debounce window for settle.
- NFS / SMB mounts are supported by the fallback path (stat works on network mounts).
EOF
}

# ── Parse args ──────────────────────────────────────────────────────────────
PATH_ARG=""
HEARTBEAT=0
TIMEOUT=0
DEBOUNCE=2
SINGLE=0
PREFIX=""
TICK=2  # sleep-poll fallback tick in seconds

while (( $# > 0 )); do
    case "$1" in
        --help|-h)
            show_usage
            exit 0
            ;;
        --single)
            SINGLE=1
            ;;
        --prefix)
            shift; PREFIX="${1:-}"
            ;;
        --timeout)
            shift; TIMEOUT="${1:?--timeout requires a value}"
            ;;
        --debounce)
            shift; DEBOUNCE="${1:?--debounce requires a value}"
            ;;
        --heartbeat)
            shift; HEARTBEAT="${1:?--heartbeat requires a value}"
            ;;
        --)
            shift; break
            ;;
        -*)
            echo "watch.sh: unknown option: $1" >&2
            show_usage >&2
            exit 1
            ;;
        *)
            if [[ -z "$PATH_ARG" ]]; then
                PATH_ARG="$1"
            else
                echo "watch.sh: unexpected positional argument: $1" >&2
                exit 1
            fi
            ;;
    esac
    shift
done

if [[ -z "$PATH_ARG" ]]; then
    echo "watch.sh: <file-path> is required (positional argument)." >&2
    show_usage >&2
    exit 1
fi

case "$PATH_ARG" in
    /*|[A-Za-z]:[/\\]*) ;;  # POSIX abs OR Windows drive letter
    *)
        echo "watch.sh: <file-path> must be absolute. Got: $PATH_ARG" >&2
        exit 1
        ;;
esac

if (( DEBOUNCE < 0 || DEBOUNCE > 60 )); then
    echo "watch.sh: --debounce must be 0..60 seconds. Got: $DEBOUNCE" >&2
    exit 1
fi

# ── Layer 1: route to watch.ps1 if pwsh is available ────────────────────────
if command -v pwsh >/dev/null 2>&1; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PS1_PATH="$SCRIPT_DIR/watch.ps1"
    if [[ ! -f "$PS1_PATH" ]]; then
        echo "watch.sh: pwsh found but watch.ps1 missing at $PS1_PATH" >&2
        exit 2
    fi
    PS_ARGS=("-File" "$PS1_PATH" "$PATH_ARG"
        "-Timeout" "$TIMEOUT"
        "-Debounce" "$DEBOUNCE"
        "-Heartbeat" "$HEARTBEAT")
    if (( SINGLE )); then
        PS_ARGS+=("-Single")
    fi
    if [[ -n "$PREFIX" ]]; then
        PS_ARGS+=("-Prefix" "$PREFIX")
    fi
    exec pwsh "${PS_ARGS[@]}"
fi

# ── Layer 2: sleep-poll fallback ───────────────────────────────────────────
emit() {
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    if [[ -n "$PREFIX" ]]; then
        echo "${ts} ${PREFIX}: $1"
    else
        echo "${ts} $1"
    fi
}

# If the file is missing at start, exit immediately with `missing`.
# We never auto-create — the watcher is a pure consumer. Producers (or wrappers like
# monitor.sh) own file lifecycle. Missing file = nothing to watch = clean exit.
if [[ ! -f "$PATH_ARG" ]]; then
    emit "missing"
    exit 0
fi

# stat -c %Y prints mtime in epoch seconds. Works on Linux + Cygwin/git-bash;
# macOS BSD stat differs (-f %m), handle both.
mtime_of() {
    if stat -c %Y "$1" >/dev/null 2>&1; then
        stat -c %Y "$1"
    else
        stat -f %m "$1"
    fi
}

last_mtime="$(mtime_of "$PATH_ARG")"
last_changed_epoch="$(date +%s)"
last_heartbeat_epoch="$last_changed_epoch"

# Leading-edge debounce state machine:
#   IDLE     — no recent activity. First mtime change → IMMEDIATE `changed` → COOLDOWN.
#   COOLDOWN — for $DEBOUNCE seconds, accumulate touches without emitting.
#              At cooldown end: if any touches, batched `changed` + restart cooldown.
#                                if none, → IDLE.
# No-touch-dropped invariant: every detected mtime change lands on at least one `changed`
# (the immediate one if from idle, or the next post-cooldown batched one).

while true; do
    sleep "$TICK"
    now="$(date +%s)"

    # Off-ramp: file deleted → emit `gone` and exit 0.
    if [[ ! -f "$PATH_ARG" ]]; then
        # Brief verify in case of atomic temp+rename in flight.
        sleep 0.2
        if [[ ! -f "$PATH_ARG" ]]; then
            emit "gone"
            exit 0
        fi
    fi

    cur_mtime="$(mtime_of "$PATH_ARG")"

    if [[ "$cur_mtime" != "$last_mtime" ]]; then
        # IDLE → emit immediately (leading edge).
        last_mtime="$cur_mtime"
        emit "changed"
        last_changed_epoch="$(date +%s)"
        last_heartbeat_epoch="$last_changed_epoch"

        if (( SINGLE )); then exit 0; fi

        # Enter COOLDOWN if debounce > 0.
        if (( DEBOUNCE > 0 )); then
            while true; do
                cooldown_end=$(( $(date +%s) + DEBOUNCE ))
                touch_in_cooldown=0
                while (( $(date +%s) < cooldown_end )); do
                    sleep "$TICK"
                    if [[ ! -f "$PATH_ARG" ]]; then
                        sleep 0.2
                        if [[ ! -f "$PATH_ARG" ]]; then
                            emit "gone"
                            exit 0
                        fi
                    fi
                    cur_mtime="$(mtime_of "$PATH_ARG")"
                    if [[ "$cur_mtime" != "$last_mtime" ]]; then
                        last_mtime="$cur_mtime"
                        touch_in_cooldown=1
                    fi
                done
                if (( touch_in_cooldown )); then
                    emit "changed"
                    last_changed_epoch="$(date +%s)"
                    last_heartbeat_epoch="$last_changed_epoch"
                    continue
                fi
                break
            done
        fi
        continue
    fi

    # IDLE this tick. Check heartbeat / timeout windows.
    idle_since_changed=$(( now - last_changed_epoch ))
    idle_since_heartbeat=$(( now - last_heartbeat_epoch ))

    if (( TIMEOUT > 0 && idle_since_changed >= TIMEOUT )); then
        emit "timeout"
        exit 0
    fi

    if (( HEARTBEAT > 0 && idle_since_heartbeat >= HEARTBEAT )); then
        emit "heartbeat"
        last_heartbeat_epoch="$now"
    fi
done

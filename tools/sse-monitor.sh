#!/usr/bin/env bash
# sse-monitor.sh — TMCP SSE activity monitor (heartbeat-filtered, auto-reconnect, safe off-ramp)
#
# Sibling of tools/monitor.sh (file-watch path). This is the SSE (HTTP-mode) path.
# Swarm-reviewed (2 rounds). Companion: tools/monitor.ps1 (file-watch, Windows).
#
# PURPOSE
#   Keep the agent connected to TMCP's SSE event stream and wake it ONLY on
#   real messages. Heartbeats (`: keepalive` / `: connected`) are consumed
#   inside this script — they never reach the agent. The agent sees only
#   `data:` lines on STDOUT.
#
# OUTPUT PROTOCOL — STDOUT ONLY (every stdout line becomes an agent wake event)
#   data: <event>                 — real SSE event from the bridge; act on it
#   data: MONITOR_EXIT reason=server_cancelled action=rearm_with_new_subscription
#                                 — server closed gracefully; re-arm subscription
#   data: MONITOR_EXIT reason=auth_failed http_status=<code> action=acquire_new_token
#                                 — unrecoverable auth error; get a new token
#   data: MONITOR_EXIT reason=max_retries_exceeded attempts=<n> action=check_bridge_health
#                                 — bridge unreachable after MAX_RETRIES; check health
#   data: MONITOR_EXIT reason=setup_failed detail=<...> action=check_environment
#                                 — could not create the local FIFO; environment problem
#
# STDERR carries ALL advisory/self-healing noise (reconnect attempts, heartbeat
# debug, etc.). The agent never sees stderr as events. Zero spurious stdout.
#
# EXIT CODES
#   0  — clean server-initiated cancel (data: cancelled) — re-arm
#   1  — unrecoverable auth failure (HTTP 401/403)       — acquire new token
#   2  — bridge unreachable after max retries            — check bridge health
#   3  — local setup failure (mkfifo)                    — check environment
#   130/143 — terminated by SIGINT/SIGTERM (clean shutdown by supervisor)
#
# USAGE
#   bash sse-monitor.sh <sse_url>
#   e.g. bash sse-monitor.sh "http://bridge:3098/sse?token=12345"
#   Arm via the Monitor tool with persistent: true.
#
# DEAD-CONNECTION DETECTION
#   Uses `read -t SILENCE_TIMEOUT` per-line idle timeout (75 s = 2 missed
#   keepalives + 15 s grace). Any arriving line — heartbeat or data — resets
#   the idle clock simply by causing `read` to return successfully. No watchdog
#   process, no timestamp file, no exported variables required.
#
# CURL PID MANAGEMENT
#   curl is backgrounded as a direct job feeding a named FIFO; $! immediately
#   captures the real curl PID. The read loop consumes from the FIFO on fd 3.
#   Teardown kills only that specific PID — never `kill 0`. SIGINT/SIGTERM run
#   cleanup AND exit, so a supervising agent can always stop the monitor.

set -uo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SSE_URL="${1:?Usage: sse-monitor.sh <sse_url>}"
SILENCE_TIMEOUT=75      # seconds of silence = dead connection (2 missed keepalives + grace)
MAX_RETRIES=8           # max consecutive reconnect attempts before permanent exit
BACKOFF_INITIAL=2       # first retry delay (seconds)
BACKOFF_CAP=60          # maximum retry delay (seconds)

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
curl_pid=""
fifo=""
_cleaned=0
fails=0
backoff=$BACKOFF_INITIAL

# ---------------------------------------------------------------------------
# terminate_curl — tear down the current connection attempt. Idempotent; safe
# to call every loop iteration and from the cleanup trap.
# ---------------------------------------------------------------------------
terminate_curl() {
    exec 3<&- 2>/dev/null || true          # close our read end → curl's write unblocks/EOFs
    if [[ -n "${curl_pid:-}" ]]; then
        kill "$curl_pid" 2>/dev/null || true
        wait "$curl_pid" 2>/dev/null || true
        curl_pid=""
    fi
    if [[ -n "${fifo:-}" ]]; then
        rm -f "$fifo"
        fifo=""
    fi
}

# ---------------------------------------------------------------------------
# cleanup — runs exactly once (re-entrancy guard). Bound to EXIT; the signal
# traps call cleanup then exit explicitly so the monitor is always killable.
# ---------------------------------------------------------------------------
cleanup() {
    [[ $_cleaned -eq 1 ]] && return
    _cleaned=1
    terminate_curl
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

# ---------------------------------------------------------------------------
# Main reconnect loop
# ---------------------------------------------------------------------------
while true; do

    # Create a fresh FIFO for this connection attempt.
    fifo="$(mktemp -u)"
    if ! mkfifo "$fifo" 2>/dev/null; then
        echo "data: MONITOR_EXIT reason=setup_failed detail=mkfifo_failed action=check_environment"
        fifo=""
        exit 3
    fi

    # Background curl directly — NOT in a pipeline — so $! is curl's real PID.
    # -w '\n%{http_code}\n' appends the HTTP status code as a bare line after EOF.
    # curl writes to the FIFO; we open the read end on fd 3.
    curl -sS -N \
         -H 'Accept: text/event-stream' \
         -w '\n%{http_code}\n' \
         "$SSE_URL" \
         > "$fifo" 2>/dev/null &
    curl_pid=$!          # real curl PID — curl is the backgrounded command, not a subshell

    exec 3< "$fifo"      # open FIFO read end; this unblocks curl's open of the write end

    # --- Inner read loop ---
    got_cancel=0
    last_http_code=""

    while IFS= read -r -t "$SILENCE_TIMEOUT" -u 3 line; do
        # read returned 0 → got a line within the timeout window
        line="${line%$'\r'}"   # strip trailing CR — SSE framing may use CRLF

        case "$line" in
            "")
                # SSE field separator — ignore
                continue
                ;;
            :*)
                # Heartbeat / comment line (`: keepalive`, `: connected`, etc.)
                # CONSUME — do NOT echo to stdout.
                continue
                ;;
            "data: cancelled")
                # Server-initiated graceful close
                echo "data: MONITOR_EXIT reason=server_cancelled action=rearm_with_new_subscription"
                got_cancel=1
                break
                ;;
            data:*)
                # Real SSE event — emit to stdout (agent wake)
                echo "$line"
                # First real data after a reconnect: reset failure counters
                fails=0
                backoff=$BACKOFF_INITIAL
                continue
                ;;
            [0-9][0-9][0-9])
                # Trailing HTTP status code injected by curl -w '\n%{http_code}\n'
                # Store it; do NOT echo to stdout
                last_http_code="$line"
                continue
                ;;
            *)
                # Unknown line — ignore silently
                continue
                ;;
        esac
    done
    read_exit=$?
    # read_exit > 128  → timed out (SILENCE_TIMEOUT exceeded, dead connection)
    # read_exit == 1   → EOF (curl exited cleanly or dropped)
    # read_exit == 0   → loop exited via break (got_cancel)

    # --- Tear down this connection attempt (idempotent helper) ---
    terminate_curl

    # If read timed out, emit a stderr advisory (not stdout — not an agent event)
    if (( read_exit > 128 )); then
        echo "MONITOR_INFO dead_connection_detected silence=${SILENCE_TIMEOUT}s classifying_as=transient_drop" >&2
    fi

    # --- Exit classification (evaluated in strict priority order) ---

    # 1. Server-initiated cancel — clean exit
    if [[ $got_cancel -eq 1 ]]; then
        exit 0
    fi

    # 2. Auth failure — permanent, emit terminal event and exit.
    #    last_http_code is populated synchronously from the -w output line,
    #    read before the loop ended; no race with an async header file.
    if [[ "${last_http_code:-}" == "401" || "${last_http_code:-}" == "403" ]]; then
        echo "data: MONITOR_EXIT reason=auth_failed http_status=${last_http_code} action=acquire_new_token"
        exit 1
    fi

    # 3. Transient drop — reconnect with exponential backoff
    fails=$(( fails + 1 ))
    if (( fails >= MAX_RETRIES )); then
        echo "data: MONITOR_EXIT reason=max_retries_exceeded attempts=${fails} action=check_bridge_health"
        exit 2
    fi

    echo "MONITOR_INFO reconnecting attempt=${fails}/${MAX_RETRIES} delay=${backoff}s" >&2
    sleep "$backoff"

    # Exponential backoff with cap
    backoff=$(( backoff * 2 ))
    (( backoff > BACKOFF_CAP )) && backoff=$BACKOFF_CAP

done

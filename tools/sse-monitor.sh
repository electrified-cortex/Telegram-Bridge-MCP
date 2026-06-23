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
#   read exit code is captured directly (while true; do read; rc=$?) — NOT via
#   `$?` after `while read; done` (that captures the loop body's last status,
#   always 0, making silence detection dead code).
#
# RECONNECT STABILITY (H5)
#   fails/backoff reset only after MIN_STABLE_SECS uptime — not on first data.
#   A server that sends one event then drops must still exhaust MAX_RETRIES.
#
# CURL PID MANAGEMENT
#   curl is backgrounded as a direct job feeding a named FIFO; $! immediately
#   captures the real curl PID. The read loop consumes from the FIFO on fd 3.
#   Teardown kills only that specific PID — never `kill 0`. SIGINT/SIGTERM run
#   cleanup AND exit, so a supervising agent can always stop the monitor.
#   Backoff sleep uses `sleep & wait $!` for signal interruptibility.

set -uo pipefail

# ---------------------------------------------------------------------------
# Bash preflight — EPOCHSECONDS requires bash 5.0+.
# ---------------------------------------------------------------------------
if [ -z "${BASH_VERSION:-}" ]; then
    echo "data: MONITOR_EXIT reason=not_bash action=run_with_bash"
    exit 3
fi
if (( BASH_VERSINFO[0] < 5 )); then
    echo "data: MONITOR_EXIT reason=bash_too_old action=run_with_bash_5_0_or_later"
    exit 3
fi

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SSE_URL="${1:?Usage: sse-monitor.sh <sse_url>}"
# Validate URL to prevent flag injection
if [[ ! "$SSE_URL" =~ ^https?:// ]]; then
    echo "data: MONITOR_EXIT reason=setup_failed detail=invalid_url action=check_environment"
    exit 3
fi
SILENCE_TIMEOUT=75      # seconds of silence = dead connection (2 missed keepalives + grace)
MAX_RETRIES=8           # max consecutive reconnect attempts before permanent exit
BACKOFF_INITIAL=2       # first retry delay (seconds)
BACKOFF_CAP=60          # maximum retry delay (seconds)
MIN_STABLE_SECS=15      # connection must be up this long before fails/backoff reset (H5)

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
curl_pid=""
fifo=""
fifo_dir=""
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
    # fifo_dir is NOT removed here — cleanup() owns the directory teardown.
}

# ---------------------------------------------------------------------------
# cleanup — runs exactly once (re-entrancy guard). Bound to EXIT; the signal
# traps call cleanup then exit explicitly so the monitor is always killable.
# ---------------------------------------------------------------------------
cleanup() {
    [[ $_cleaned -eq 1 ]] && return
    _cleaned=1
    terminate_curl
    [[ -n "${fifo_dir:-}" ]] && rm -rf "$fifo_dir"
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

# ---------------------------------------------------------------------------
# FIFO setup — create a private temp directory once. The same FIFO path is
# recreated each reconnect iteration; the directory lives until cleanup() on exit.
# Using mktemp -d avoids the TOCTOU race inherent in mktemp -u + mkfifo.
# ---------------------------------------------------------------------------
fifo_dir="$(mktemp -d)" || {
    echo "data: MONITOR_EXIT reason=setup_failed detail=mktemp_d_failed action=check_environment"
    exit 3
}

# ---------------------------------------------------------------------------
# Main reconnect loop
# ---------------------------------------------------------------------------
while true; do

    # Create a fresh FIFO for this connection attempt inside the persistent temp dir.
    fifo="${fifo_dir}/fifo"
    if ! mkfifo "$fifo" 2>/dev/null; then
        echo "data: MONITOR_EXIT reason=setup_failed detail=mkfifo_failed action=check_environment"
        fifo=""
        exit 3
    fi

    # Background curl directly — NOT in a pipeline — so $! is curl's real PID.
    # -w '\n%{http_code}\n' appends the HTTP status code as a bare line after EOF.
    # curl writes to the FIFO; we open the read end on fd 3.
    curl -sS -N \
         --connect-timeout 10 \
         -H 'Accept: text/event-stream' \
         -w '\n%{http_code}\n' \
         -- "$SSE_URL" \
         > "$fifo" 2>/dev/null &
    curl_pid=$!          # real curl PID — curl is the backgrounded command, not a subshell

    exec 3<>"$fifo"     # open FIFO r/w — non-blocking open avoids deadlock if curl exits
                        # before opening the write end. Our write ref is never used for
                        # writing; terminate_curl closes fd 3 entirely via exec 3<&-.
                        # EOF detection falls back to the 75s SILENCE_TIMEOUT path.

    # --- Inner read loop ---
    # H1/H2 fix (empirically verified): `$?` after `while read; done` is the loop
    # BODY's last exit status, not read's exit code when the condition failed. Every
    # body path ends in `continue` (status 0), so read_exit was always 0 — dead code.
    # Fixed by `while true; do read; read_exit=$?` — direct capture yields:
    #   read_exit > 128 (142) → SILENCE_TIMEOUT exceeded (dead connection / class C)
    #   read_exit == 1        → EOF (curl exited: clean drop or server close)
    #   read_exit == 0        → successful read; line processed; loop continues
    got_cancel=0
    last_http_code=""
    read_exit=0
    conn_start=$EPOCHSECONDS   # H5: track uptime for stable-connection reset

    while true; do
        IFS= read -r -t "$SILENCE_TIMEOUT" -u 3 line
        read_exit=$?
        if (( read_exit != 0 )); then
            break
        fi
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
                # H5: do NOT reset fails/backoff here. Reset is deferred to the
                # post-loop section where conn_uptime can be checked. A server that
                # sends one event then immediately drops must still exhaust MAX_RETRIES.
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
    # read_exit is now correctly captured:
    # > 128 (142) → silence timeout (dead connection)
    # == 1        → EOF (curl dropped / exited)
    # == 0        → exited via break (got_cancel or cancel-path break)

    # --- Tear down this connection attempt (idempotent helper) ---
    terminate_curl

    # If read timed out, emit a stderr advisory (now correctly reachable)
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

    # H5: stable-connection check — only reset fails/backoff if the connection was
    # healthy for at least MIN_STABLE_SECS. A server that accepts then immediately
    # drops (post-welcome flap) must still exhaust MAX_RETRIES, not retry forever.
    conn_uptime=$(( EPOCHSECONDS - conn_start ))
    if (( conn_uptime >= MIN_STABLE_SECS )); then
        echo "MONITOR_INFO stable_connection_reset uptime=${conn_uptime}s" >&2
        fails=0
        backoff=$BACKOFF_INITIAL
    fi

    # 3. Transient drop — reconnect with exponential backoff
    fails=$(( fails + 1 ))
    if (( fails >= MAX_RETRIES )); then
        echo "data: MONITOR_EXIT reason=max_retries_exceeded attempts=${fails} action=check_bridge_health"
        exit 2
    fi

    echo "MONITOR_INFO reconnecting attempt=${fails}/${MAX_RETRIES} delay=${backoff}s" >&2

    # H4: sleep in background + wait so bash can service INT/TERM traps during backoff.
    # `wait` for a background job is interruptible; the trap fires immediately on signal.
    sleep "$backoff" & wait $!

    # Exponential backoff with cap
    backoff=$(( backoff * 2 ))
    (( backoff > BACKOFF_CAP )) && backoff=$BACKOFF_CAP

done

#!/usr/bin/env bash
# Reconnecting SSE monitor wrapper for TMCP.
# Adapted from simple-im/monitor-reconnect.sh for TMCP's query-param auth convention.
#
# Each kick emits "new message" to stdout; reconnect attempts go to stderr.
# Exits 0 on clean HTTP close (server-initiated); loops on TCP error / 401.
#
# Usage:
#   bash monitor-reconnect-tmcp.sh <token> [server-url] [retry-delay-secs]
#
# <token>       : TMCP session token integer (from action(type:"session/start"))
# [server-url]  : defaults to http://localhost:4891
# [retry-delay] : seconds between reconnect attempts, defaults to 3
#
# Example Monitor tool command:
#   bash /path/to/monitor-reconnect-tmcp.sh 1123456 http://127.0.0.1:4891 3

TOKEN="$1"
SERVER_URL="${2:-http://localhost:4891}"
RETRY_DELAY="${3:-3}"

if [ -z "$TOKEN" ]; then
    echo "Usage: bash monitor-reconnect-tmcp.sh <token> [server-url] [retry-delay-secs]" >&2
    exit 1
fi

while true; do
    curl -N -s -f \
        "$SERVER_URL/sse?token=$TOKEN" \
    | while IFS= read -r line; do
        if [ "$line" = "data: kick" ]; then
            echo "new message"
        fi
    done

    # PIPESTATUS[0] = curl exit code; PIPESTATUS[1] = while-loop exit code
    CURL_EXIT="${PIPESTATUS[0]}"

    if [ "$CURL_EXIT" -eq 0 ]; then
        # Clean close — server sent EOF (e.g. session deregistered).
        exit 0
    fi

    # Non-zero: TCP drop (56) or HTTP error (22) — retry.
    echo "[monitor-reconnect-tmcp] curl exited $CURL_EXIT; retrying in ${RETRY_DELAY}s..." >&2
    sleep "$RETRY_DELAY"
done

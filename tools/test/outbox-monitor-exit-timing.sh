#!/usr/bin/env bash
# tools/test/outbox-monitor-exit-timing.sh
# Standalone test for outbox/monitor.sh 200ms exit timing [CRITICAL-AC2].
#
# Validates that after the monitor emits 'timeout' the process exits within
# 200ms — i.e., no extra sleep or blocking happens post-emission.
#
# Expected duration: ~3-4s (TICK=2 + --timeout 3 --single).
# Emits PASS/FAIL lines; exits 0 when all pass, 1 when any fail.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONITOR="$SCRIPT_DIR/fixtures/outbox-monitor.sh"
SIGNAL="$SCRIPT_DIR/fixtures/.signal"

PASS=0
FAIL=0

check() {
    local desc="$1" result="$2"
    if [[ "$result" == "PASS" ]]; then
        echo "PASS: $desc"
        PASS=$((PASS + 1))
    else
        echo "FAIL: $desc"
        FAIL=$((FAIL + 1))
    fi
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
if [[ ! -f "$MONITOR" ]]; then
    echo "FAIL: monitor.sh not found at $MONITOR"
    exit 1
fi

# Use a FIFO for line-by-line stdout capture with accurate timestamps.
FIFO="$(mktemp -u)"
mkfifo "$FIFO"

cleanup() {
    rm -f "$FIFO"
    rm -f "$SIGNAL"   # remove signal file created by the monitor under test
}
trap cleanup EXIT

# Pre-delete .signal to prevent the 5-second self-reset delay that fires when
# a stale signal file is found at startup (only relevant in non-single mode,
# but kept here as a safety measure).
rm -f "$SIGNAL"

# ---------------------------------------------------------------------------
# Test 1: 'timeout' token → process exit ≤ 200ms
# ---------------------------------------------------------------------------
echo "--- Test 1: outbox/monitor.sh 200ms exit timing ---"
echo "(Expected duration: ~3-4 seconds; TICK=2, --timeout 3 --single)"

# --single skips the 5-second self-reset so the test remains fast.
# The timeout mechanism fires independently of --single.
bash "$MONITOR" --timeout 3 --single > "$FIFO" &
MPID=$!

TIMEOUT_TS=""
GOT_TIMEOUT=0

# Read from the FIFO in the foreground until we see 'timeout'.
# Record the timestamp immediately when that token arrives.
while IFS= read -r line; do
    if [[ "$line" == "timeout" ]]; then
        TIMEOUT_TS="$(date +%s%3N)"
        GOT_TIMEOUT=1
        break
    fi
done < "$FIFO"

# Wait for the monitor process to exit; record that timestamp.
wait "$MPID" 2>/dev/null || true
EXIT_TS="$(date +%s%3N)"

# ---------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------
if [[ $GOT_TIMEOUT -eq 0 ]]; then
    check "monitor.sh emits 'timeout' (did not arrive within expected window)" "FAIL"
else
    check "monitor.sh emits 'timeout' token" "PASS"

    DELTA=$(( EXIT_TS - TIMEOUT_TS ))
    if [[ $DELTA -le 200 ]]; then
        check "process exits ≤200ms after 'timeout' token (delta: ${DELTA}ms)" "PASS"
    else
        check "process exits ≤200ms after 'timeout' token (delta: ${DELTA}ms — expected ≤200ms)" "FAIL"
    fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

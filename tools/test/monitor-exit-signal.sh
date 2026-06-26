#!/usr/bin/env bash
# tools/test/monitor-exit-signal.sh
# AC3 behavioral test for monitor.sh MONITOR_EXIT content-detection (10-3029).
#
# Verifies that when an activity file is written with MONITOR_EXIT content,
# monitor.sh emits `closed` and exits cleanly (exit 0).
#
# Emits PASS/FAIL lines; exits 0 when all pass, 1 when any fail.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONITOR="$SCRIPT_DIR/../monitor.sh"

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

# ---------------------------------------------------------------------------
# Test 1: MONITOR_EXIT content causes `closed` emit and clean exit
# ---------------------------------------------------------------------------
echo "--- Test 1: monitor.sh emits 'closed' and exits on MONITOR_EXIT content ---"

ACTIVITY_FILE="$(mktemp)"
OUTPUT_FILE="$(mktemp)"

cleanup() {
    rm -f "$ACTIVITY_FILE" "$OUTPUT_FILE"
}
trap cleanup EXIT

# Write initial (non-MONITOR_EXIT) content so monitor establishes baseline mtime
echo "normal content" > "$ACTIVITY_FILE"

# Start monitor in background, capturing output to temp file
bash "$MONITOR" "$ACTIVITY_FILE" > "$OUTPUT_FILE" &
MPID=$!

# Give monitor time to start and establish baseline mtime
sleep 1

# Now write MONITOR_EXIT content (overwrite — must start with MONITOR_EXIT)
printf 'MONITOR_EXIT reason=subscription_closed_unexpectedly action=re-arm' > "$ACTIVITY_FILE"

# Wait up to 8 seconds for monitor to exit (poll interval is 2s, so ~2-4s expected)
for _ in 1 2 3 4; do
    sleep 2
    if ! kill -0 "$MPID" 2>/dev/null; then
        break
    fi
done

# Check if monitor exited
if kill -0 "$MPID" 2>/dev/null; then
    kill "$MPID" 2>/dev/null || true
    wait "$MPID" 2>/dev/null || true
    check "monitor.sh exits after MONITOR_EXIT content written (did not exit within 8s)" "FAIL"
else
    wait "$MPID" 2>/dev/null
    EXIT_CODE=$?
    check "monitor.sh exits after MONITOR_EXIT content written" "PASS"

    if [[ $EXIT_CODE -eq 0 ]]; then
        check "monitor.sh exits 0 after emitting 'closed'" "PASS"
    else
        check "monitor.sh exits 0 after emitting 'closed' (got exit code $EXIT_CODE)" "FAIL"
    fi

    # Check output for `closed` token
    if grep -q "^closed$" "$OUTPUT_FILE" 2>/dev/null; then
        check "monitor.sh output contains 'closed' token" "PASS"
    else
        ACTUAL_OUTPUT="$(cat "$OUTPUT_FILE" 2>/dev/null || echo '<empty>')"
        check "monitor.sh output contains 'closed' token (got: '$ACTUAL_OUTPUT')" "FAIL"
    fi

    # Check output does NOT contain `notify` for the MONITOR_EXIT change
    if grep -q "^notify$" "$OUTPUT_FILE" 2>/dev/null; then
        check "MONITOR_EXIT change emitted 'notify' instead of 'closed' (unexpected)" "FAIL"
    else
        check "MONITOR_EXIT change does not emit 'notify' (correct — emits 'closed' instead)" "PASS"
    fi
fi

# ---------------------------------------------------------------------------
# Test 2: Normal content change emits `notify`, not `closed`
# ---------------------------------------------------------------------------
echo ""
echo "--- Test 2: normal content change emits 'notify', not 'closed' ---"

ACTIVITY_FILE2="$(mktemp)"
OUTPUT_FILE2="$(mktemp)"
trap 'rm -f "$ACTIVITY_FILE" "$OUTPUT_FILE" "$ACTIVITY_FILE2" "$OUTPUT_FILE2"' EXIT

echo "initial content" > "$ACTIVITY_FILE2"

bash "$MONITOR" "$ACTIVITY_FILE2" --timeout 6 > "$OUTPUT_FILE2" &
MPID2=$!

sleep 1

# Append a newline (normal activity-file touch, not MONITOR_EXIT)
echo "" >> "$ACTIVITY_FILE2"

# Wait for monitor to exit (should timeout after 6s idle, or exit sooner on notify)
wait "$MPID2" 2>/dev/null || true

if grep -q "^notify$" "$OUTPUT_FILE2" 2>/dev/null; then
    check "normal content change emits 'notify'" "PASS"
else
    ACTUAL2="$(cat "$OUTPUT_FILE2" 2>/dev/null || echo '<empty>')"
    check "normal content change emits 'notify' (got: '$ACTUAL2')" "FAIL"
fi

if grep -q "^closed$" "$OUTPUT_FILE2" 2>/dev/null; then
    check "normal content change does NOT emit 'closed'" "FAIL"
else
    check "normal content change does NOT emit 'closed'" "PASS"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

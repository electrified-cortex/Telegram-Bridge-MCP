#!/usr/bin/env bash
# tools/test/sse-monitor-url-validation.sh
# Standalone test for sse-monitor.sh URL validation (10-0014).
# Emits PASS/FAIL lines; exits 0 when all pass, 1 when any fail.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONITOR="$SCRIPT_DIR/../sse-monitor.sh"

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
# Test 1: ftp:// URL is rejected — stdout must contain MONITOR_EXIT setup_failed
# ---------------------------------------------------------------------------
output1=$(bash "$MONITOR" ftp://example.com 2>/dev/null | head -1)
if echo "$output1" | grep -q "MONITOR_EXIT reason=setup_failed detail=invalid_url"; then
    check "ftp:// URL rejected with MONITOR_EXIT setup_failed detail=invalid_url" "PASS"
else
    check "ftp:// URL rejected with MONITOR_EXIT setup_failed detail=invalid_url (got: '$output1')" "FAIL"
fi

# ---------------------------------------------------------------------------
# Test 2: dash-prefix injection attempt is rejected
#   'bash sse-monitor.sh -- -x evil' → $1='--', which fails ^https?://
# ---------------------------------------------------------------------------
output2=$(bash "$MONITOR" -- -x evil 2>/dev/null | head -1)
if echo "$output2" | grep -q "MONITOR_EXIT reason=setup_failed detail=invalid_url"; then
    check "dash-prefix injection rejected with MONITOR_EXIT setup_failed detail=invalid_url" "PASS"
else
    check "dash-prefix injection rejected with MONITOR_EXIT setup_failed detail=invalid_url (got: '$output2')" "FAIL"
fi

# ---------------------------------------------------------------------------
# Test 3 (negative): valid http:// URL passes URL validation
#   Connection failure is expected (127.0.0.1:1 is not listening), but the
#   script must NOT emit setup_failed/invalid_url on its first output line.
# ---------------------------------------------------------------------------
first_line=$(timeout 5 bash "$MONITOR" http://127.0.0.1:1 2>/dev/null | head -1 || true)
if [[ -z "$first_line" ]] || ! echo "$first_line" | grep -q "setup_failed.*invalid_url"; then
    check "valid http:// URL passes URL validation (no setup_failed on first line)" "PASS"
else
    check "valid http:// URL passes URL validation (no setup_failed on first line, got: '$first_line')" "FAIL"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

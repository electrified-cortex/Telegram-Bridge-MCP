#!/usr/bin/env pwsh
# tools/test/monitor-file-deletion.ps1
# Standalone test for monitor.ps1 file-deletion mid-wait [MAJOR-ps1-AC3].
#
# Validates that deleting the watched file while FileSystemWatcher.WaitForChanged()
# is blocking does NOT crash the script — the try/catch falls through to
# Start-Sleep and the script eventually exits cleanly via -Timeout.
#
# Expected duration: ~10-12s (-Timeout 10).
# Emits PASS/FAIL lines; exits 0 when all pass, 1 when any fail.

$ErrorActionPreference = 'Continue'

$pass = 0
$fail = 0
$scriptDir = $PSScriptRoot
$monitor   = Join-Path $scriptDir '..' 'monitor.ps1'

function Check {
    param([string]$Desc, [bool]$Cond, [string]$Detail = '')
    if ($Cond) {
        Write-Output "PASS: $Desc"
        $script:pass++
    } else {
        $extra = if ($Detail) { " ($Detail)" } else { '' }
        Write-Output "FAIL: $Desc$extra"
        $script:fail++
    }
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
if (-not (Test-Path $monitor)) {
    Write-Output "FAIL: monitor.ps1 not found at $monitor"
    exit 1
}

Write-Output '--- Test: monitor.ps1 file-deletion mid-wait ---'
Write-Output '(Expected duration: ~10-12s with -Heartbeat 2 -Timeout 10)'

# ---------------------------------------------------------------------------
# Test: delete watched file while WaitForChanged is blocking
# ---------------------------------------------------------------------------
$tempActivity = [System.IO.Path]::GetTempFileName()
$outFile      = [System.IO.Path]::GetTempFileName()
$errFile      = [System.IO.Path]::GetTempFileName()

try {
    # Start monitor watching the temp file
    $proc = Start-Process pwsh -ArgumentList @(
        '-NonInteractive', '-File', $monitor,
        $tempActivity, '-Heartbeat', '2', '-Timeout', '10'
    ) -RedirectStandardOutput $outFile `
      -RedirectStandardError  $errFile `
      -PassThru -NoNewWindow

    # Give the monitor time to enter WaitForChanged (~0.5s is enough)
    Start-Sleep -Milliseconds 500

    # Delete the watched file while WaitForChanged is blocking.
    # This is the race condition being tested.
    Remove-Item -Force $tempActivity -ErrorAction SilentlyContinue

    # Wait for the monitor to exit on its own via -Timeout 10
    $exited = $proc.WaitForExit(15000)   # 15s outer guard

    $stdout = if (Test-Path $outFile) { (Get-Content $outFile -Raw) -replace "`r", '' } else { '' }
    $stderr = if (Test-Path $errFile) { (Get-Content $errFile -Raw) -replace "`r", '' } else { '' }
    if ($null -eq $stdout) { $stdout = '' }
    if ($null -eq $stderr) { $stderr = '' }

    # --- Assertions ---

    Check 'process exits within 15s of file deletion' $exited

    if ($exited) {
        Check 'exit code is 0' ($proc.ExitCode -eq 0) "got $($proc.ExitCode)"
    }

    $stderrSample = if ($stderr.Length -gt 0) {
        'stderr: ' + $stderr.Substring(0, [Math]::Min(300, $stderr.Length)).Trim()
    } else { '' }

    Check 'no unhandled exception in stderr' `
        (-not ($stderr -match 'Unhandled Exception|Exception calling.*WaitForChanged')) `
        $stderrSample

    $stdoutSample = if ($stdout.Length -gt 0) {
        'stdout: ' + $stdout.Substring(0, [Math]::Min(300, $stdout.Length)).Trim()
    } else { '' }

    Check 'no unhandled exception in stdout' `
        (-not ($stdout -match 'Unhandled Exception|Exception calling.*WaitForChanged')) `
        $stdoutSample

    # Monitor should have emitted at least one heartbeat and/or a timeout token
    Check 'stdout contains expected output tokens (heartbeat or timeout)' `
        ($stdout -match 'heartbeat|timeout') `
        $(if ($stdout.Trim()) { "stdout: $($stdout.Trim())" } else { 'stdout was empty' })

} finally {
    # Ensure process is terminated if still running
    if ($null -ne $proc -and -not $proc.HasExited) {
        $proc.Kill()
    }
    Remove-Item -Force $outFile, $errFile, $tempActivity -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Output ''
Write-Output "Results: $pass passed, $fail failed"
exit $(if ($fail -eq 0) { 0 } else { 1 })

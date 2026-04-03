#!/bin/bash
# Wrapper for claim.ps1 — routes to PowerShell with full parameter pass-through
pwsh -File "$(dirname "$0")/claim.ps1" "$@"

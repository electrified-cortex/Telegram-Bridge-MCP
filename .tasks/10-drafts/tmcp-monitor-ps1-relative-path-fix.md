---
name: tmcp-monitor-relative-path-bug
description: "TMCP's activity_file_monitor_instructions service message ships `tools/monitor.ps1` as a RELATIVE path; agent CWD has no `tools/` dir, so first arm exits 127. Use absolute TMCP path until upstream fixed."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c696b5fd-34f0-452f-9265-6ba93a76d2e9
---

When TMCP returns the `activity_file_monitor_instructions` service message, the script path is *relative* (`tools/monitor.ps1`, `tools/monitor.sh`). An agent environment without a `tools/` directory in its working directory will hit exit 127 the first time it tries to arm the activity-file monitor.

**Why:** TMCP onboarding text was written assuming the caller's CWD is the TMCP repo. Some environments work because an earlier sync copied `tools/monitor.sh` into the agent's working directory (vendored). Environments without such a copy will see the relative path resolve to a missing file.

**How to apply:**

- On any fresh agent boot, arm the activity-file monitor with the absolute path:
  - Windows: `"<TMCP-checkout-root>\tools\monitor.ps1"` (absolute path resolved from wherever the TMCP repo is checked out)
  - Linux/macOS sibling: `tools/monitor.sh` under same TMCP root.
- Always pass the activity file as a quoted absolute path too.
- Verify a kick event arrives before trusting the monitor — see [[monitor-fragility-mindset]].
- Real fix candidates (escalate via [[friction-protocol]] when bandwidth allows):
  1. TMCP onboarding emits its own absolute path (best — single source of truth).
  2. Pod template vendors `tools/` (drift risk).
  3. Spawn script symlinks TMCP `tools/` into pod root.

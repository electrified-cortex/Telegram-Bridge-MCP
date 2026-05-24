---
type: idea
status: parked
filed-by: Curator
date: 2026-05-23
origin: operator voice 2026-05-23T~08:50PT (Curator boot)
related:
  - memory: feedback_tmcp_monitor_relative_path (Curator pod)
---

# `activity_file_monitor_instructions` should ship an absolute path (or repo-rooted hint)

## Observation

When TMCP returns the `activity_file_monitor_instructions` service message, the script path is *relative*:

```
Windows:  `tools/monitor.ps1 "<activity_file>"`
Linux/macOS:  `tools/monitor.sh "<activity_file>"`
```

Pods whose CWD is not the TMCP repo (i.e. all pods — pod CWD is always the pod's own root) fail with **exit 127** on first arm. Curator hit this at boot 2026-05-23: the relative `tools/monitor.ps1` resolved to `D:\...\.curator-pod\tools\monitor.ps1`, which does not exist (the `.assistant-pod` template ships no `tools/` dir).

BT happens to work only because earlier sync-work vendored a copy of `tools/monitor.sh` into the BT pod root.

## Operator-suggested fix

> "Can the message say in, you know, something like 'In the telegram MCP root, like brackets or something /tools' instead of just saying 'tools/monitor.ps1'?"

So either:

1. **Absolute path** — TMCP knows its own repo root (via `__dirname` or equivalent). Emit fully-qualified path. Single source of truth, zero ambiguity, no per-pod vendoring required.
2. **Repo-rooted hint** — Prefix path with explicit `[TMCP repo]/tools/monitor.ps1` so the agent knows it must resolve against the bridge install dir, not its own CWD. Still requires the agent to know where TMCP lives.

Option 1 is strictly stronger and roughly the same code change.

## Acceptance criteria

- [ ] `activity_file_monitor_instructions` payload's `text` field uses absolute path to `tools/monitor.{ps1,sh}`.
- [ ] `details.script_path` field added (Windows and POSIX variants) so agents can consume the path structurally rather than parsing prose.
- [ ] Existing relative-path callers (any?) audited and migrated.
- [ ] Re-verified on a fresh Curator boot: first `Monitor` call with the supplied command line succeeds without exit 127.

## Notes

- Same problem may exist for any other service message that suggests a path. Worth a sweep — see if `setup-hooks.sh`, `spawn.*`, or other hint messages also assume CWD.
- Touches Curator memory `feedback_tmcp_monitor_relative_path.md` — once shipped + verified, that memory can be retired.

## Delegation

Curator-owned (drafting). Hand to Overseer for vetting before release to Workers.

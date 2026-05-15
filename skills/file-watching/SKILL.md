---
name: file-watching
description: Watch a single file for modification and emit one debounced event line per settled burst. Optimized native (FileSystemWatcher on Windows; sleep-poll fallback elsewhere). Triggers — watch a file, monitor file changes, file mtime change, react on file write.
---

## Usage

```pwsh
pwsh -File <skill-path>/watch.ps1 <file-path> [-Single] [-Prefix <s>] [-Timeout <s>] [-Debounce <s>] [-Heartbeat <s>]
```

```bash
bash <skill-path>/watch.sh <file-path> [--single] [--prefix <s>] [--timeout <s>] [--debounce <s>] [--heartbeat <s>]
```

- `<file-path>` (required, positional) — absolute path to the file to watch
- `-Single` / `--single` — exit 0 after the first `changed`. Combined with timeout, whichever fires first ends the script
- `-Prefix <string>` / `--prefix <string>` — insert `"<prefix>: "` between the timestamp and the token on every emitted line. Default empty
- `-Timeout <s>` / `--timeout <s>` — exit after N consecutive idle seconds. Prints `timeout` then exits 0. Default: never
- `-Debounce <s>` / `--debounce <s>` — coalescing window: rapid changes collapse into one `changed` after N seconds of quiet. Range 0-60. Default: 2
- `-Heartbeat <s>` / `--heartbeat <s>` — emit a `heartbeat` line every N idle seconds. Default: off
- `-Help` / `--help` — print usage and exit

## Output

Every line on stdout has the format:

```
<ISO8601-UTC-timestamp> [<prefix>: ]<token>
```

Examples:

```
2026-05-15T05:48:32Z changed
2026-05-15T05:48:35Z Inbox: changed
2026-05-15T05:49:32Z Inbox: heartbeat
2026-05-15T05:50:00Z Inbox: gone
```

Tokens:

- `changed` — file changed (leading-edge debounced); act on it
- `heartbeat` — `-Heartbeat` window elapsed without a change (proves the watcher is alive)
- `timeout` — `-Timeout` window elapsed without a change; script exited 0
- `gone` — watched file was deleted while running; script exited 0
- `missing` — watched file did not exist at script start; script exited 0 immediately. The watcher is a pure consumer — file lifecycle is the producer's job.

The timestamp is always ISO 8601 UTC with second precision and a trailing `Z`. Consumers parsing the line can split on the first space to separate the timestamp from the rest.

## Off-ramp — delete the file to close the channel

**The canonical way to stop a watcher is to delete the watched file.** No `kill`, no `TaskStop`, no signal handling — just `rm <file>`. The watcher detects the deletion, emits `gone` and exits 0.

This is the recommended shutdown idiom across pod inbox/outbox monitors. To close your inbox channel, delete `inbox/.signal`. The monitor unravels, the channel is gone. Re-create the file later to re-open.

The file-deleted-while-watching path includes a 200ms verify window so atomic temp+rename saves (Vim, VSCode) do not trigger a false exit.

**Default behavior:** delete = exit. There is no `--wait-for-recovery` flag — once the file is gone, the watcher is done. Re-arm a new watcher if you want to resume.

## Variants

- `watch.ps1` — **canonical, recommended path.** Event-driven via `FileSystemWatcher` (kernel-native, zero idle CPU). Requires PowerShell 7+. Works out-of-the-box on Windows; install `pwsh` on macOS / Linux to get the same behavior everywhere.
- `watch.sh` — convenience router. If `pwsh` is on PATH, exec `watch.ps1` (full feature parity). Otherwise, falls back to a 2-second sleep-poll loop. The fallback is correct in principle but has only been smoke-tested in Windows-bash environments — real macOS / Linux behavior is unverified.

> **Recommendation:** install PowerShell 7+ on any host that runs this skill. The pwsh path is the only one we test end-to-end; the bash fallback is for hosts where `pwsh` truly isn't an option.

## When to use

- You're arming a Monitor (or any subprocess) on a file you care about.
- You want event-driven, zero-poll wake-ups (PowerShell path) or low-latency polling (bash fallback).
- The watched file is local. Network mounts (NFS / SMB) don't propagate kernel events; the bash fallback handles them, the pwsh path silently fails.

## When NOT to use

- You need to watch a directory recursively (different shape).
- You need to watch many files (spawn N watchers, or use a different pattern).
- You need sub-second reaction with `-Debounce 0` AND high write rates — caller may be flooded.

## Don'ts

- Don't auto-install missing tools. Caller policy. Detect, use, or fail.
- Don't watch multiple files in one process. One file per script invocation.
- Don't add behavior beyond emit-on-change. Composition belongs at the caller.

# Skill: file-watching

## Purpose

Watch a single file for modification and emit one event line per change. Optimized — uses native OS file-event APIs when available, falls back gracefully otherwise. Caller-agnostic: any agent or script that needs to react to file changes can call this skill instead of writing its own polling loop.

## Scope

In scope:

- Single-file watching by absolute path.
- Event-driven detection via `FileSystemWatcher` (PowerShell variant) or sleep-poll (bash fallback).
- Configurable inactivity heartbeat (`heartbeat` lines on idle window).
- Configurable inactivity timeout (clean exit after idle window).
- Debounce window (rapid bursts collapse to one `changed` after quiet).
- Two language variants — `watch.ps1` (PWSH 7+) and `watch.sh` (POSIX bash) — exposing the same contract.
- Atomic temp+rename save detection (editor pattern).

## Definitions

- **changed** — the token emitted on stdout when the watched file's content has changed (write, append, atomic temp-then-rename save). Either fired immediately on the first change from idle (leading edge) or batched after a cooldown window if multiple changes piled up.
- **debounce** — leading-edge cooldown window. The first change from an idle state fires `changed` **immediately**; the watcher then enters cooldown for `<Debounce>` seconds. Additional changes during cooldown accumulate but do NOT fire individual `changed` lines. When cooldown ends: if any changes arrived during it, emit one batched `changed` and restart the cooldown; if none arrived, return to idle (next change is again immediate).
- **No-touch-dropped invariant** — every detected change is represented in at least one `changed`. Either the immediate-from-idle line (if it triggered the burst) or the batched post-cooldown line (if it arrived during a cooldown).
- **heartbeat** — token emitted on stdout when the configured `-Heartbeat` window elapses with no `changed`. Proves the watcher is alive; lets callers distinguish "quiet" from "dead."
- **timeout** — token emitted on stdout when the configured `-Timeout` window elapses with no `changed`; the script exits 0 immediately after.
- **timestamp** — every output line is prefixed with an ISO 8601 UTC timestamp (`YYYY-MM-DDTHH:MM:SSZ`) followed by a single space, then optional `<prefix>: `, then the token. Format is fixed; not configurable. Captured at emit time, not at event time.
- **mtime** — POSIX modification timestamp. The OS-level signal underlying most file-change detection.
- **FileSystemWatcher** — `System.IO.FileSystemWatcher`, the .NET wrapper over each OS's native file-event API (`ReadDirectoryChangesW` on Windows, `inotify` on Linux, `kqueue`/FSEvents on macOS).
- **Spurious event** — a change notification for a property a caller likely doesn't care about (atime read, chmod, attribute flip). Suppressed at the watcher's `NotifyFilter`.
- **Atomic temp+rename save** — the editor pattern of writing to `<file>.tmp` then `rename(<file>.tmp, <file>)`. The watcher receives `Created`/`Renamed` events on the destination, not `Changed`.
- **Tick** — one iteration of the watcher's wait loop. Sized to the smaller of `-Heartbeat` or `-Timeout` (with a sensible upper bound) so those windows fire on schedule.
- **Single mode** — `-Single` / `--single`. Exit cleanly (exit code 0) after the first `changed`. Combined with `-Timeout`, whichever fires first ends the script.
- **Prefix** — `-Prefix <string>` / `--prefix <string>`. String inserted between the timestamp and the token (followed by `": "`) on every emitted line. Default empty. Used by callers that consume multiple watch streams to disambiguate output.
- **gone** — token emitted when the watched file is detected to be deleted **while the script is running**. Followed immediately by exit 0. Provides a clean shutdown signal: a caller deletes the watched file to ask the watcher to die without process-killing it.
- **missing** — token emitted when the watched file does NOT exist **at script start**. Followed immediately by exit 0. The watcher is a pure consumer; missing file = nothing to watch = clean exit. Producers (or wrappers like `monitor.sh`) own file lifecycle.

## Output format

Every line on stdout has the structure:

```text
<ISO8601-UTC-timestamp> [<prefix>: ]<token>
```

The timestamp is always present. `<prefix>: ` is present only when `-Prefix` is set and non-empty. Examples:

```text
2026-05-15T05:48:32Z changed
2026-05-15T05:48:35Z Inbox: changed
2026-05-15T05:49:32Z Inbox: heartbeat
2026-05-15T05:50:00Z Inbox: gone
```

Consumers MUST treat the timestamp as informational and parse the post-timestamp tail for routing decisions. Splitting the line on the first space yields `<timestamp>` and `<rest>`; consumers may then strip an optional `<prefix>: ` from `<rest>` to recover the token.

## Requirements

- Tool emits `changed` on **leading-edge debounce** semantics (see Definitions). Idle + first change → immediate `changed`. Cooldown window (`<Debounce>` seconds) follows. Subsequent touches during cooldown are batched into one post-cooldown `changed`.
- **Debounce is mandatory and first-class.** Default window: **2 seconds**. Configurable via `-Debounce <seconds>`. Range: 0 (disabled, fire on every event) to 60 (one-minute cooldown). Values outside the range are rejected with exit 1.
- **No-touch-dropped invariant** must hold: every detected change is represented in at least one `changed`. The implementation tracks "touch arrived during cooldown" state and fires a batched `changed` at cooldown-end if any did.
- Optional inactivity heartbeat: `heartbeat` line every N seconds with no `changed` (configurable).
- Optional inactivity timeout: exit cleanly after N seconds with no `changed` (configurable, prints `timeout` then exits 0).
- Optional single-shot mode (`-Single` / `--single`): script exits 0 after emitting the first `changed`. If combined with `-Timeout`, whichever fires first ends the script. Used by callers (e.g. self-healing wrappers) that want one observation per launch.
- Optional output prefix (`-Prefix <string>` / `--prefix <string>`): when set, every emitted line places `<prefix>: ` between the timestamp and the token. Affects all five token types (changed, heartbeat, timeout, gone, missing). Default empty (no prefix).
- **Every output line is timestamped.** Format: `<ISO8601-UTC> [<prefix>: ]<token>`. Timestamp is captured at emit time using `[DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")` (PowerShell) or `date -u +%Y-%m-%dT%H:%M:%SZ` (bash). Always second precision; always a trailing `Z`. Not configurable.
- **Delete-as-shutdown signal.** When the watched file is deleted while the script is running, emit `gone` and exit 0. Brief verify (~200ms) is performed before exiting so atomic temp+rename saves do not trigger a false exit.
- **Pure consumer — no auto-create.** If the watched file does NOT exist at script start, emit `missing` and exit 0. The watcher does NOT create the file or wait for it to appear. File lifecycle is owned by the producer/wrapper layer (e.g. `monitor.sh`, `post.sh`).
- Watches a single file path passed as the first positional argument. Path must be absolute.
- PowerShell variant (`watch.ps1`) ships first. Uses `System.IO.FileSystemWatcher` — event-driven, zero idle CPU, no external dependencies on Windows.
- **PowerShell function names use approved verbs** (`Clear-FwEvents`, `Wait-AnyEvent`, `Write-Token`, `Write-Changed`, `Test-Deleted`) so the script loads without unapproved-verb warnings.
- Bash variant (`watch.sh`) is a thin router. v1 contract: detect `pwsh` on PATH; if present, exec `watch.ps1` with the same arguments and exit with its exit code. If absent, fall back to a sleep-poll loop (default tick: **2 seconds**, mtime-stat based) implementing the same contract (changed / heartbeat / timeout / debounce). Future versions MAY add `inotifywait` / `fswatch` paths but the pwsh-route + sleep-poll fallback are the v1 floor.
- Filters spurious events (atime, chmod) — only mtime-relevant changes fire `changed`.
- Handles atomic temp+rename saves (common in editors): event still fires when the final state lands.
- Self-contained: no install required to run on Windows. `pwsh` is the only prerequisite.
- Help is inline in the script via `-Help` / `--help`.

## Constraints

- **Single file per invocation.** One process watches exactly one path. Callers needing N watches spawn N processes.
- **Absolute path only.** The positional `<file-path>` argument MUST be absolute. Relative paths are rejected with exit code 1.
- **PowerShell 7+ required for `watch.ps1`.** `#Requires -Version 7` is enforced. Windows PowerShell 5.1 is unsupported.
- **OS-native event delivery.** `watch.ps1` uses `Register-ObjectEvent` + `Wait-Event` rather than `WaitForChanged()` (the latter silently drops events in some pwsh runtimes). Future variants must verify event delivery against this baseline.
- **Network-mounted filesystems degrade.** NFS / SMB / sshfs do not propagate kernel file-change events. On those mounts the watcher receives nothing; behavior is "appears alive but never `changed`s." Caller must polling-fallback when the watch target is on a network mount.
- **PowerShell path is the only fully-tested variant.** `watch.ps1` is recommended on every host. `watch.sh`'s sleep-poll fallback (when `pwsh` is absent) is structurally correct but has not been verified on a native macOS or Linux host — only in Windows-bash environments. Treat the bash fallback as best-effort until end-to-end testing on those platforms lands.
- **Heartbeat does not affect Timeout.** The two windows use independent clocks: `Timeout` measures idle-since-last-`changed`; `Heartbeat` measures idle-since-last-emission (`changed` or heartbeat). A heartbeat firing does not reset the timeout countdown.
- **First `changed` from idle is instant.** The leading-edge model means callers see file activity within milliseconds of the first change — debounce only smooths follow-on bursts. This is the opposite of trailing-edge debounce, where every emission eats the full window of latency.
- **Cooldown rolls.** Each batched `changed` (post-cooldown) restarts the cooldown. Sustained chatter produces one `changed` every `<Debounce>` seconds, not a flood and not silence.
- **Burst coalescing happens at two layers.** First the kernel may collapse N rapid writes into one OS event (Windows often does for sub-100ms bursts); then the cooldown collapses the remaining events into one batched `changed`. The no-touch-dropped invariant guarantees ≥1 `changed` per change; it does NOT guarantee 1:1 emission-per-write.
- **Timestamp format is fixed.** Always `YYYY-MM-DDTHH:MM:SSZ` (ISO 8601 UTC, second precision, trailing `Z`). Not configurable. Consumers depend on this format.
- **Help is inline.** `-Help` / `--help` prints usage and exits 0; no external man-page or doc dependency.

## Out of scope

- Multi-file watching (one file per process; caller spawns N processes if it needs N watches).
- Directory watching (single-file only; directory recursion is a different shape).
- Auto-installing missing native tools (operator policy: never auto-install). The bash variant detects what's present and uses or falls back; never installs.
- Doing anything with the `changed` beyond emitting it (caller decides what `changed` means).
- Sub-second timestamp precision; a separate format flag; ISO-8601 alternatives (basic format, offset rather than `Z`, etc.). Out of scope to keep the wire format stable.

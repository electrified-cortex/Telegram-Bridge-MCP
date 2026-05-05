---
id: "10-0871"
title: "Replace activity/file hint with help() pointer + add help topic"
type: feature
priority: 30
status: queued
created: 2026-05-05
repo: Telegram MCP
delegation: Worker
depends_on: ["10-0870"]
---

# Replace activity/file hint with help() pointer + add help topic

## Context (2026-05-05)

The `activity/file/create` (and soon `activity/file/edit` per 10-0870) response now carries a one-line `hint` field:

```json
"hint": "Configure your watcher to call dequeue() when this file changes"
```

That hint is too thin to actually onboard a fresh agent. The full pattern includes: what watcher to use, how to detect mtime changes vs appended content, what to do on wake, role-permission caveats, error modes. None of that fits in a one-liner.

Standard TMCP idiom for "go read more" is `help(topic: '<name>')`. We should redirect there.

## Fix

### Step 1 — Add help topic `activity/file`

`src/tools/help.ts` (or wherever help topics are registered) gets a new topic. Content covers:

- **Purpose**: opt-in wake mechanism so agents don't long-poll dequeue.
- **Lifecycle**: `activity/file/create` → register; `activity/file/edit` → swap path; `activity/file/delete` → unregister; `activity/file/get` → introspect current state.
- **Wake mechanism**: TMCP bumps the file's mtime when there are events. Content stays empty/stable; mtime is the signal.
- **Watcher patterns**:
  - `tail -F` does NOT work — only follows appended bytes, not mtime.
  - Bash poll: `prev=$(stat -c%Y "$f"); while ...; cur=$(stat ...); [ "$cur" != "$prev" ] && echo "call dequeue()" && prev=$cur; sleep 1; done`.
  - PS `FileSystemWatcher`: event-driven, native Windows, no poll cost.
  - `inotifywait -e attrib`: Linux-only; not in git-bash.
- **What to emit on wake**: anything self-instructing — `call dequeue()` is the canonical phrasing because the wake-message text becomes a notification I read and act on.
- **What to do on wake**: call `dequeue` with the session token. Drain until empty.
- **Permission caveat**: the harness's Monitor (or equivalent watcher tool) must be in the agent's allowlist. Without it, the watcher can't run; fall back to long-poll dequeue.
- **Error modes**: file deleted out from under TMCP, mtime not bumping, permission denied on stat.

### Step 2 — Replace hint string in both endpoints

`src/tools/activity/create.ts` (both response sites + JSDoc):

```ts
return toResult({ file_path: ..., hint: "Call help('activity/file') now" });
```

`src/tools/activity/edit.ts` (both response sites + JSDoc — assumes 10-0870 has landed and reshaped this file to the matching new shape):

```ts
return toResult({ file_path: ..., hint: "Call help('activity/file') now", previous_path: ... });
```

## Build + test

`pnpm build`, `pnpm test`. New help topic should be exercised by a small test that calls `help(topic: 'activity/file')` and asserts it's not the unknown-topic error.

## Acceptance criteria

- `help(topic: 'activity/file')` returns the workflow doc above (wake mechanism, watcher patterns, role permissions, error modes).
- Both `activity/file/create` and `activity/file/edit` emit `hint: "Call help('activity/file') now"`.
- Build + tests green.
- A fresh agent reading the response + calling help can configure a watcher without prior context.

## Out of scope

- Spoon-feeding dequeue from the watcher itself (separate task — see 10-0872).
- Rewriting the dequeue help topic.
- Cross-agent (Curator/Overseer/Worker) settings.json permission rollout for Monitor — that's a workspace-side change, not a TMCP change.

## Dispatch

Worker, Sonnet for the help-topic content (needs nuance), Haiku for the hint-string edits + test.

## Bailout

90 min. If the help-registry shape isn't obvious, surface to Curator with `src/tools/help.ts` head.

## Notes

- Dependency: `10-0870` must land first so the edit-side response shape is normalized; otherwise this task has to do that reshape too.
- The hint string change is trivial; the help topic is the real work.
- Workspace memory `feedback_telegram_session_lifecycle.md` may want a pointer to this help topic post-merge.

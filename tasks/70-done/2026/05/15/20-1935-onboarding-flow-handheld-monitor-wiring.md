# 20-1935 — onboarding flow: handheld agent walkthrough with inline monitor wiring

## Context

The current `session/start` response embeds a `monitor_recipe` field containing a raw shell script. This is wrong for two reasons: (1) the monitor instruction is detached from the file path agents need to use it, and (2) a shell script blob is not an agent-readable hint. The goal is an in-lockstep onboarding flow where agents are walked through each step without having to think.

## Required flow

### Step 1 — `session/start` response

Remove `monitor_recipe` entirely. The only hint should be:

```
"Call dequeue(token) NOW — do not proceed without draining"
```

### Step 2 — service message surfaced via dequeue

When an agent dequeues after session start (and has no activity file registered), include a service message that guides optional monitor setup:

```
"Optional: register an activity file so TMCP can kick you when new messages arrive.
Call activity/file/create to set one up — TMCP will tell you how to monitor it."
```

Timing: this message should appear early in the dequeue stream for a fresh session with no activity file.

### Step 3 — `activity/file/create` response

Return both the dequeue nudge AND the monitor instruction inline with the file path:

```json
{
  "hint": "Call dequeue(token: <TOKEN>) NOW — do not proceed without draining",
  "file_path": "<path>",
  "monitor": "Run tools/monitor.ps1 <path> (preferred on Windows) or tools/monitor.sh <path> from your repo root to watch for kicks."
}
```

The `monitor` field replaces all use of `CANONICAL_MONITOR_RECIPE`.

## Cleanup

- Delete `src/tools/activity/canonical-recipe.ts` and its test file `canonical-recipe.test.ts`
- Remove `monitor_recipe` import and usage from `src/tools/session/start.ts`
- Update `docs/help/activity/file.md` to reflect new flow

## Acceptance criteria

1. `session/start` response has no `monitor_recipe` field.
2. Dequeue stream for a fresh session (no activity file) includes a service message prompting `activity/file/create`.
3. `activity/file/create` response includes `file_path` + `monitor` field with ps1/sh instructions (ps1 preferred).
4. `canonical-recipe.ts` and its test deleted.
5. All tests pass.
6. An Opus-level dispatch agent reviews the changes before merge — foreman must note this in their result.

## Source

Operator 2026-05-16: "an agent starts up, it is handheld, walked into success — barely has to think. session/start → call dequeue. service message → set up monitor if you want. activity/file/create → here's your file, here's how to monitor it."

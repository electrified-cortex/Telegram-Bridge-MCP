profile/load — Load saved profile into current session.

Sparse-merge: keys present in profile overwrite session values; absent keys untouched.
Multiple loads stack. Use after session/start to bootstrap voice, animations, reminders.

## Params
token: session token (required)
key: profile key to load (required)
  Bare name (e.g. "Worker") → loads from data/profiles/
  Path key (e.g. "profiles/Worker") → loads relative to repo root

## Example
action(type: "profile/load", token: 3165424, key: "Worker")
→ { loaded: true, key: "Worker", applied: ["voice", "reminders"] }

## Standard startup sequence
action(type: "session/start", name: "Worker 2")
→ save token
action(type: "profile/load", token: ..., key: "Worker")
action(type: "reminder/list", token: ...)
dequeue(token: ...)

## Error cases
NOT_FOUND → profile doesn't exist; create with profile/save first
READ_FAILED → file exists but invalid JSON

Related: profile/save, profile/import, session/start
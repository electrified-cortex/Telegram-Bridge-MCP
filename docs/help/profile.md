Profile — Session configuration and persistence.

Routes:
- profile/load — load saved profile (voice, animations, reminders)
- profile/save — snapshot current session config to file
- profile/voice — set TTS voice and speed
- profile/topic — set message topic prefix
- profile/dequeue-default — set default dequeue timeout
- profile/import — apply profile data inline (no file)

action(type: "profile") — lists sub-paths in live API.

Profiles stored in data/profiles/{key}.json (gitignored).
Checked-in profiles: load with path key (e.g. "profiles/Worker").

## Auto-load flag

`profile/save({ key: 'X', autoload: true })` marks the profile for automatic application when a session named X starts.
`profile/load` returns the `autoload` field so callers can inspect it.
`profile/import` accepts and echoes the `autoload` flag in its result (does not write to disk).

Related: session/start, reminder/set, animation/default

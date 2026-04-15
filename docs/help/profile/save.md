profile/save — Snapshot current session config to profile file.

Saves voice, voice_speed, animation_default, animation_presets, and reminders.
Saves to data/profiles/{key}.json (gitignored). Use path key with profile/load to load from checked-in profiles.

## Params
token: session token (required)
key: bare profile name (required; no slashes; e.g. "Worker")

## Example
action(type: "profile/save", token: 3165424, key: "Worker")
→ { saved: true, key: "Worker", path: "data/profiles/Worker.json", sections: ["voice", "reminders"] }

## Notes
- Bare key only (no path separators)
- Only saves sections that differ from defaults
- Overwrites existing profile with same key

Related: profile/load, profile/import, set_voice, animation/default, reminder/set
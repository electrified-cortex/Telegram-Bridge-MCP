# Session Profiles

Persist session configuration across server restarts. A **profile** is a JSON file that captures a session's voice, animation, and reminder settings. Loading a profile sparse-merges its contents into the current session — keys present in the file overwrite; keys absent are untouched.

## Storage

A profile key is either a bare name or a relative path:

- **Bare key** (`Overseer`) → `data/profiles/Overseer.json` (gitignored)
- **Path key** (`profiles/Overseer`) → `profiles/Overseer.json` (relative to repo root) — **load only**

`action(type: "profile/save")` only accepts bare keys — path keys are rejected to keep tool-written files in the gitignored tier. `action(type: "profile/load")` accepts both, allowing agents to load hand-curated checked-in profiles.

Path traversal (`..`) and absolute paths are rejected. The `data/` directory is gitignored.

## Tools

### `action(type: "profile/save", key)`

Snapshots the current session's state to `data/profiles/{key}.json`. Only bare keys are accepted — path keys are rejected to prevent tool-written files outside the gitignored tier. Checked-in profiles are hand-curated.

Captures:

- `voice` — voice name (omitted when not set)
- `voice_speed` — TTS speed multiplier (0.25–4.0, omitted when not set)
- `animation_default` — default animation frames (omitted when not set)
- `animation_presets` — named preset map
- `reminders` — reminder definitions (for example: text, delay_seconds, recurring, trigger)

### `action(type: "profile/load", key)`

Reads the profile JSON and sparse-merges into the current session:

- Each top-level key present in the file overwrites the session's value.
- Missing keys = no change.
- `animation_presets` merges at the individual preset level (loading a profile with a `thinking` preset does not wipe an existing `working` preset).
- Multiple loads stack: `action(type: "profile/load", key: "profiles/Base")` then `action(type: "profile/load", key: "profiles/Overseer")` — second overwrites only what it defines.

Returns the merged state summary so the agent knows what was applied.

### `action(type: "session/start")` hint

The `action(type: "session/start")` response includes a hint:

```text
If you have a saved profile, call action(type: "profile/load", key) to restore your configuration.
```

No listing, no discovery. The agent must know its profile key.

## File Format

```jsonc
{
  "voice": "alloy",
  "voice_speed": 1.2,
  "animation_default": ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"],
  "animation_presets": {
    "thinking": ["🤔 Thinking.", "🤔 Thinking..", "🤔 Thinking..."],
    "working": ["Working.", "Working..", "Working..."]
  },
  "reminders": [
    { "text": "Check task board for hygiene", "delay_seconds": 900, "recurring": true },
    { "text": "Git state audit", "delay_seconds": 900, "recurring": true },
    { "text": "Resume any in-progress tasks", "recurring": true, "trigger": "startup" }
  ]
}
```

All fields are optional. A profile containing only `voice` is valid.

## Security

- Keys are validated against a strict pattern — no path traversal, no absolute paths.
- `action(type: "profile/save")` only writes to the gitignored tier.
- No listing tool — agents must know the key. This prevents enumeration.
- Profile content is not executable — it is pure configuration data applied through existing APIs.

## Examples

### Worker bootstrap (before profiles)

```text
action(type: "session/start", name: "Worker")         → SID 2, PIN 123456
action(type: "profile/voice", voice: "nova")
action(type: "animation/default", name: "thinking", frames: [...])
action(type: "animation/default", name: "working", frames: [...])
action(type: "reminder/set", text: "...", delay_seconds: 15, recurring: true)
action(type: "reminder/set", text: "...", delay_seconds: 15, recurring: true)
action(type: "reminder/set", text: "...", delay_seconds: 10, recurring: true)
```

7+ tool calls, large prompt context for reminder definitions.

### Worker bootstrap (with profiles)

```text
action(type: "session/start", name: "Worker")         → SID 2, PIN 123456
action(type: "profile/load", key: "profiles/Worker")  → voice, presets, reminders all restored
```

2 tool calls. No prompt bloat.

### Layered loading

```text
action(type: "profile/load", key: "profiles/Base")     → common reminders, default animation
action(type: "profile/load", key: "profiles/Overseer") → overseer-specific voice, extra reminders
```

Second load merges on top of first. Non-conflicting settings from Base remain.

# Session Profiles

Persist session configuration across server restarts. A **profile** is a JSON file that captures a session's voice, animation, and reminder settings. Loading a profile sparse-merges its contents into the current session — keys present in the file overwrite; keys absent are untouched.

## Storage

A profile key is either a bare name or a relative path:

- **Bare key** (`Overseer`) → `data/profiles/Overseer.json` (gitignored)
- **Path key** (`profiles/Overseer`) → `profiles/Overseer.json` (relative to repo root) — **load only**

`save_profile` only accepts bare keys — path keys are rejected to keep tool-written files in the gitignored tier. `load_profile` accepts both, allowing agents to load hand-curated checked-in profiles.

Path traversal (`..`) and absolute paths are rejected. The `data/` directory is gitignored.

## Tools

### `save_profile(key)`

Snapshots the current session's state to `data/profiles/{key}.json`. Only bare keys are accepted — path keys are rejected to prevent tool-written files outside the gitignored tier. Checked-in profiles are hand-curated.

Captures:

- `voice` — voice name (omitted when not set)
- `voice_speed` — TTS speed multiplier (0.25–4.0, omitted when not set)
- `animation_default` — default animation frames (omitted when not set)
- `animation_presets` — named preset map
- `reminders` — active reminder definitions (text, delay, recurring)

### `load_profile(key)`

Reads the profile JSON and sparse-merges into the current session:

- Each top-level key present in the file overwrites the session's value.
- Missing keys = no change.
- `animation_presets` merges at the individual preset level (loading a profile with a `thinking` preset does not wipe an existing `working` preset).
- Multiple loads stack: `load_profile("profiles/Base")` then `load_profile("profiles/Overseer")` — second overwrites only what it defines.

Returns the merged state summary so the agent knows what was applied.

### `session_start` hint

The `session_start` response includes a hint:

```text
If you have a saved profile, call load_profile(key) to restore your configuration.
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
    { "text": "Git state audit", "delay_seconds": 900, "recurring": true }
  ]
}
```

All fields are optional. A profile containing only `voice` is valid.

## Security

- Keys are validated against a strict pattern — no path traversal, no absolute paths.
- `save_profile` only writes to the gitignored tier.
- No listing tool — agents must know the key. This prevents enumeration.
- Profile content is not executable — it is pure configuration data applied through existing APIs.

## Examples

### Worker bootstrap (before profiles)

```text
session_start(name: "Worker")         → SID 2, PIN 123456
set_voice(voice: "nova")
set_default_animation(name: "thinking", frames: [...])
set_default_animation(name: "working", frames: [...])
set_reminder(text: "...", delay_seconds: 15, recurring: true)
set_reminder(text: "...", delay_seconds: 15, recurring: true)
set_reminder(text: "...", delay_seconds: 10, recurring: true)
```

7+ tool calls, large prompt context for reminder definitions.

### Worker bootstrap (with profiles)

```text
session_start(name: "Worker")         → SID 2, PIN 123456
load_profile("profiles/Worker")       → voice, presets, reminders all restored
```

2 tool calls. No prompt bloat.

### Layered loading

```text
load_profile("profiles/Base")         → common reminders, default animation
load_profile("profiles/Overseer")     → overseer-specific voice, extra reminders
```

Second load merges on top of first. Non-conflicting settings from Base remain.

# Profiles

Profiles are caller-side configuration stored under `data/profiles/` at runtime. The bridge does NOT ship profile files — bring your own.

## Loading a profile

```text
action(type: "profile/load", token: <token>, key: "<name>")
```

`<name>` resolves to `data/profiles/<name>.json` by default. Prefix with `profiles/` to load from a `profiles/` directory at repo root if you want to commit non-secret defaults alongside the bridge.

## Schema

```jsonc
{
  // TTS voice. See your TTS provider's voice catalog.
  "voice": "<voice-id>",
  "voice_speed": 1.0,

  // Optional name-tag emoji prefixed to outbound message author labels.
  "nametag_emoji": "🧠",

  // Default ambient animation when no specific preset is set.
  "animation_default": ["· · ·", "• · ·", "· • ·", "· · •"],

  // Named animation presets. Each is an array of frame strings.
  "animation_presets": {
    "thinking": ["thinking…"],
    "working":  ["working…"]
  },

  // Recurring or startup-fired reminders.
  "reminders": [
    { "text": "Heartbeat reminder", "delay_seconds": 600, "recurring": true, "trigger": "time" }
  ]
}
```

Every field is optional except `voice` (TTS-related sends will fall back to a server default if omitted).

## Notes

- Profile files are caller config and may contain identifying or workflow-specific text. **Do NOT commit profiles you don't want to publish.** The default `data/profiles/` lives outside version control.
- `action(type: "profile/save", ...)` writes the active session's voice/animation/reminder state to a key under `data/profiles/`.
- `action(type: "profile/import", ...)` lets you ingest a profile JSON in-band without touching disk.

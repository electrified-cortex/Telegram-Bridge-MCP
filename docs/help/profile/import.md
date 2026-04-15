profile/import — Apply profile data inline without file I/O.

Accepts same structure as profile JSON. All fields optional — sparse merge.
Use to load profiles from external sources or apply ad-hoc config without saving to disk first.

## Params
token: session token (required)
voice: voice name (optional; e.g. "alloy")
voice_speed: TTS speed multiplier (optional; 0.25–4.0)
animation_default: default animation frame array (optional)
animation_presets: named preset map (optional; { name: frames[] })
reminders: reminder array (optional; [{ text, delay_seconds, recurring }])

## Example
action(type: "profile/import", token: 3165424, voice: "nova", reminders: [
  { text: "Check pipeline", delay_seconds: 1800, recurring: true }
])
→ { imported: true, applied: ["voice", "reminders"] }

## Inline preset registration
action(type: "profile/import", token: 3165424, animation_presets: {
  "working": ["⚙️", "⚙️ .", "⚙️ .."]
})

Related: profile/load, profile/save, profile/voice, animation/default, reminder/set
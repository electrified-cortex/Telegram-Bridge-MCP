animation/default — Configure session default animation frames and named presets.

Pass frames to set session default. Pass name+frames to register named preset.
Pass reset: true to restore built-in default. Pass no args to query current state.

## Params
token: session token (required)
frames: animation frame array (optional; e.g. ["⚙️", "⚙️ .", "⚙️ .."])
name: register frames as named preset with this key (optional)
preset: set default from existing preset by name (optional; omit frames when using)
reset: restore built-in default (optional; ignores frames/name)

## Examples
Set session default:
action(type: "animation/default", token: 3165424, frames: ["⚙️", "⚙️ .", "⚙️ .."])
→ { action: "default_set", default_frames: [...], presets: [] }

Register named preset:
action(type: "animation/default", token: 3165424, name: "working", frames: ["⚙️", "⚙️ .", "⚙️ .."])
→ { action: "preset_registered", name: "working", frames: [...] }

Set default from preset:
action(type: "animation/default", token: 3165424, preset: "working")

Reset to built-in:
action(type: "animation/default", token: 3165424, reset: true)

Query current:
action(type: "animation/default", token: 3165424)
→ { default_frames: [...], session_presets: [...], builtin_presets: [...] }

Full guide: help(topic: 'animation')

Related: animation/cancel, profile/save, profile/import
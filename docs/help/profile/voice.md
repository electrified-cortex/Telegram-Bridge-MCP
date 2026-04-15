profile/voice — Set per-session TTS voice override.

Overrides global default for this session only. Other sessions unaffected.
Pass empty string to clear override and revert to global default.

## Params
token: session token (required)
voice: voice name (required; pass "" to clear; e.g. "alloy", "nova", "echo")
speed: TTS speed multiplier (optional; 0.25–4.0; default 1.0)

## Examples
action(type: "profile/voice", token: 3165424, voice: "nova")
→ { voice: "nova", speed: null, previous: null, set: true }

action(type: "profile/voice", token: 3165424, voice: "alloy", speed: 1.2)
→ { voice: "alloy", speed: 1.2, previous: "nova", set: true }

Clear override:
action(type: "profile/voice", token: 3165424, voice: "")
→ { voice: null, speed: null, cleared: true }

## Notes
- Session-scoped: cleared when session closes
- Persisted via profile/save → profile/load on next session

Related: profile/save, profile/load
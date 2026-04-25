Animation Frames Guide

Starting an animation:
send(type: 'animation', frames: [...], interval: 1000, timeout: 600)
Or a named preset: send(type: 'animation', preset: 'working')

Single-emoji frames warning:
Frames with only a single emoji render as large stickers on mobile (Telegram behavior).

Fix: append \u200b (zero-width space) to single-emoji frames:
  frames: ['⏳\u200b', '🔄\u200b']
Or use multi-character frames:
  frames: ['`⏳ working`', '`🔄 thinking`']

Built-in presets:
| Preset | Description |
| --- | --- |
| bounce | Block-character bouncing bar (default) |
| dots | Minimal cycling dot indicator |
| working | `[ working ]` cycling bracket animation |
| thinking | `[ thinking ]` cycling bracket animation |
| loading | `[ loading ]` cycling bracket animation |

REST hook (HTTP mode only):
POST /hook/animation — Trigger an animation from outside the MCP tool layer.
Supply the session token as ?token=N (query param) or as a "token" field in the JSON body.
Body: { "preset": "working", "timeout": 60, "persistent": false } — preset is required; timeout and persistent are optional (same semantics as show_animation).
Returns 200 { "ok": true } on success, 401 on invalid/missing token, or 400 on bad body / unknown preset.

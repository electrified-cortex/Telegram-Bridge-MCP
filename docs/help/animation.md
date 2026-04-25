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

REST trigger (HTTP mode only):
The dedicated `POST /hook/animation` endpoint was removed in 7.2. Animations are now a side-effect of the agent-event system: when the governor session emits a `compacting` event via `POST /event`, the bridge automatically triggers the `compacting` preset animation on the governor's session and cancels it on the matching `compacted` event. See `help('events')` for the event surface (kinds, body shape, auth) and `tasks/40-queued/10-0831-event-system-rest-endpoint.md` for the full design.

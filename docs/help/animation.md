Animation Frames Guide

Starting an animation:
send(type: 'animation', frames: [...], interval: 1000, timeout: 60)
Or a named preset: send(type: 'animation', preset: 'working')

Default timeout: 60 s. Omit timeout only if the animation should self-cancel within a minute.
For long-running work, pass timeout: N explicitly (max 600) — or use persistent: true and cancel manually.

When to use persistent animations:
- Only for ongoing work where progress messages flow in (append-mode pattern)
- The animation gets promoted to real content as messages come in
- Cancel explicitly when work is done: action(type: 'animation/cancel')
- Do NOT use for decoration — a stuck animation is a lie

Single-emoji frames warning:
Frames with only a single emoji render as large stickers on mobile (Telegram behavior).

Fix: append ​ (zero-width space) to single-emoji frames:
  frames: ['⏳​', '🔄​']
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
| compacting | `[ compacting ]` cycling bracket animation |
| recovering | `[ recovering ]` cycling bracket animation |

Checking animation state:
Own session:    action(type: 'animation/status') → { session: { active, message_id, frames, started_at, expires_at } }
Other session:  action(type: 'animation/status', sid: N) → { session: { ... } } (governor only)
All sessions:   action(type: 'animation/status') with no sid, when caller is governor → { sessions: [...] }

Stale-on-idle warning:
When you call dequeue and your queue is empty (idle wait begins), the bridge injects a warning
into the first dequeue response if an animation is still active:
  { event: "animation_stale_warning", message_id, age_seconds }
This is informational — no auto-cancel. Either cancel the animation or keep it if work is ongoing.

REST trigger (HTTP mode only):
HTTP-triggered animations now flow through POST /event. help('events').

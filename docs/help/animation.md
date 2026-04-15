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
| working | ⚙ Working… cycling dots |
| thinking | 🤔 Thinking… cycling dots |
| reviewing | 🔍 Reviewing… cycling dots |

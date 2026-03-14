# Animation System — Open Edge Cases

Tracking nuanced timing and UX issues discovered during real usage. These aren't bugs — they're design questions to resolve through experience.

## 1. Animation stickiness after agent reply

When the agent shows an animation (e.g. thinking dots), processes a request, then sends a reply — the animation should be cancelled. Currently, if the agent forgets to call `cancel_animation`, the placeholder sits there indefinitely until the inactivity timeout fires.

**Status:** Agent-side discipline issue. The animation inactivity timeout (default 120s) acts as a safety net.

## 2. Animation repositioning when new messages arrive

When an animation is active and either:

- The **user** sends messages below it, or
- The **bot** sends a new message (not via promotion)

...the animation placeholder is no longer the "last message." Ideally:

- User messages: animation stays in place (user is typing, don't disrupt)
- Bot messages: animation should "move down" — delete old placeholder, let the new message land, then create a fresh animation below it

**Status:** Not implemented. The current promotion flow only handles the case where the bot sends *through the proxy*. Direct sends via `bypassProxy` or out-of-band messages don't trigger repositioning.

## 3. Animation timeout vs extension

When the agent is actively working (editing messages, sending files), the animation timeout resets via `onEdit` in the interceptor. But if the agent sends a *new* message without explicitly extending the animation, should the animation:

- Stay alive (assuming the agent is still working)?
- Time out (because the agent didn't explicitly extend)?

The promotion flow handles the "send replaces animation, restart below" case. The gap is: what if the send doesn't go through the proxy (e.g. a voice message via `sendVoiceDirect`)? The `notifyBeforeFileSend`/`notifyAfterFileSend` hooks handle file sends specifically, but other custom sends might not.

**Status:** Current behavior: animation persists until timeout or explicit cancel. File sends correctly suspend/resume. Voice sends correctly suspend/resume via manual hooks.

## 4. Named presets (thinking, working, etc.)

The preset system exists (`registerPreset`, `getPreset`) but hasn't been exercised in real usage. Desired pattern:

- `thinking`: 🤔 + rotating dots (e.g. `🤔...` → `🤔·..` → `🤔.·.` → `🤔..·`)
- `working`: 🔧 + rotating dots
- Default: plain rotating dots

**Status:** Infrastructure exists, presets not registered by default. Needs agent-side convention for when to use which preset.

## 5. Disposable pattern consideration

The animation system manages multiple coupled resources (state, timers, interceptor, message store entries). A class-based disposable pattern — where an `AnimationSession` object owns all these and has a clean `dispose()` method — would eliminate several edge cases by design (zombie interceptor, orphaned timers, etc.).

**Status:** Future refactor candidate. Current functional approach works but has more edge cases to guard against.

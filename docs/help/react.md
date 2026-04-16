react — Set emoji reaction on a message.

Max 1 reaction for non-premium bots. Accepts semantic aliases or raw emoji.
Premium emoji (✅) fall back to free alternative (👍) for non-premium bots automatically.
Omit/empty emoji to remove reaction.

## Params
token: session token (required)
message_id: message ID to react to (required)
emoji: emoji or semantic alias (optional; omit to remove)
  Aliases (premium→free fallback shown where applicable):
    done/complete/finished ✅→👍  · error/failed/stop/blocked ⛔→👎
    rocket/launch 🚀→🔥
    thinking 🤔 · working/processing/busy ⏳ · approve/yes/good 👍
    ok/okay 👌 · salute/acknowledged/understood 🫡 · reading/looking/watching 👀
    heart/love ❤ · reject/no/bad 👎 · fire/hot 🔥
    tada/celebrate/party 🎉
is_big: use big animation (optional; default false; permanent reactions only)
temporary: auto-revert on next outbound action or timeout (optional; default false)
restore_emoji: emoji to restore to after temporary expires (optional; implies temporary=true)
timeout_seconds: deadline before auto-restore fires (optional; implies temporary=true)

## Examples
Semantic alias:
action(type: "react", token: 3165424, message_id: 42, emoji: "thinking")
→ { ok: true, message_id: 42, emoji: "🤔", temporary: false }

Temporary reaction:
action(type: "react", token: 3165424, message_id: 42, emoji: "working", temporary: true)
→ { ok: true, temporary: true, restore_emoji: null }

Remove reaction:
action(type: "react", token: 3165424, message_id: 42)
→ { ok: true, emoji: null }

Related: acknowledge, message/get
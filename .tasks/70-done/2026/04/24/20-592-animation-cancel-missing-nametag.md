# 20 — 592 — Animation Cancel Text Missing Name Tag

## Summary

When `animation/cancel` replaces an animation with text, the replacement
message may not include the session name tag prefix that normal `send`
messages get.

## Observed

Message 37099 (animation cancel with replacement text) had no session
name tag. All other messages in the same session had the Curator tag.

## Expected

Animation cancel replacement text should go through the same outbound
proxy path that adds session name tags to all bot messages.

## Fix

Check `animation/cancel` text replacement code path — ensure it uses
the same `editMessageText` flow that applies the session tag prefix.

# Task 016 — Session Persistence / Profiles (Spike)

**Type:** Spike / Research → Design
**Priority:** 40 (medium-low)

## Description

Investigate and design a **session profile** system where sessions can persist configuration across reconnects and restarts. Currently, sessions are ephemeral — all state (reminders, voice preferences, configs) is lost on restart.

## Ideas to Explore

- **Profile storage**: Sessions could have a named profile stored in the MCP (file-based or in-memory with persistence)
- **Bootstrap configs**: Instead of reading a prompt file, a session could declare "I'm profile X" and the MCP loads saved reminders, voice settings, animation preferences, etc.
- **Deterministic bootstrapping**: More structured than "read this prompt and do stuff" — the MCP itself applies the config on session start
- **What to persist**: Reminders, voice config (TTS voice, speed), animation presets, session name/color, custom commands
- **How to identify**: By session name? By a profile key? By operator assignment?

## Deliverable

A design document outlining the proposed persistence mechanism, what gets saved, how sessions claim a profile, and the bootstrap flow. Does NOT need implementation — just the design.

## Notes

- Backlog item. Not urgent.
- Related to multi-session architecture (v4.1.0).
- Consider security implications — a session shouldn't be able to claim another session's profile without authorization.

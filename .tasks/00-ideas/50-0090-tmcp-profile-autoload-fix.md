# TMCP profile autoload returns false — fix needed

Source: handoff/20260607T135248Z-startup.md
Filed: 2026-06-12

Telegram profile autoload is currently false. As a result, the agent must manually load the profile
on each session start.

The fix should make the profile autoload work correctly so the agent's Telegram identity loads automatically on bridge connect, eliminating a
manual step at each startup.

Root cause and fix location: inside TMCP bridge code. Investigate src/ for profile autoload logic.
Scope: local agent bridge only — do NOT apply to operator bridge without explicit operator go.
Deploy requires bridge restart (drops live MCP sessions briefly — operator must authorize timing).

#!/usr/bin/env bash
# telegram-loop-guard.sh — Claude Code Stop hook
#
# Prevents agent exit when an active Telegram session file is present in
# Claude Code project memory (~/.claude/projects/).
#
# Install: add to .claude/settings.local.json hooks (see docs/agent-setup.md)

set -euo pipefail

# --- Read hook input from stdin ---
input="$(cat)"

# --- Check stop_hook_active to prevent infinite loop ---
stop_hook_active="$(printf '%s' "$input" | grep -o '"stop_hook_active"[[:space:]]*:[[:space:]]*true' || true)"
if [ -n "$stop_hook_active" ]; then
    exit 0
fi

# --- Look for telegram session file in Claude project memory ---
session_dir="$HOME/.claude/projects"

if [ ! -d "$session_dir" ]; then
    exit 0
fi

# Search all project directories for telegram/session.md with content
found_session=""
while IFS= read -r -d '' candidate; do
    if [ -s "$candidate" ]; then
        found_session="$candidate"
        break
    fi
done < <(find "$session_dir" -name "session.md" -path "*/telegram/*" -print0 2>/dev/null)

if [ -z "$found_session" ]; then
    exit 0
fi

# --- Active session detected — block the stop ---
printf '{"decision":"block","reason":"Active Telegram session detected in ~/.claude/projects. Resume the dequeue loop. To allow stop, clear your session file."}\n'
exit 0

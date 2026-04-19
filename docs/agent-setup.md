# Agent Setup: Loop Guard and Dequeue Loop

This guide covers how to configure AI agents to stay in the Telegram dequeue loop reliably — including hook installation for both VS Code (GitHub Copilot Chat) and Claude Code.

---

## What is the loop guard?

When an agent is running a Telegram Bridge MCP session, it must remain alive and call `dequeue` continuously to receive messages. Without a loop guard, the host IDE may terminate the agent conversation at any time — dropping the session silently.

The **loop guard** is a Stop hook that checks for an active Telegram session file before allowing the host to shut down the agent. If a session file is found with content, the hook blocks the stop and prompts the agent to resume the dequeue loop. If no session file exists (or it is empty), the hook exits cleanly and allows normal shutdown.

**Two variants are provided:**

| File | Host | Platform |
| --- | --- | --- |
| `.github/hooks/telegram-loop-guard.ps1` + `.json` | VS Code / GitHub Copilot Chat | Windows (PowerShell) |
| `.claude/hooks/telegram-loop-guard.sh` | Claude Code | macOS / Linux (Bash) |

---

## VS Code / GitHub Copilot Chat

### Installation

1. **If you cloned this repo**, the hook files are already present at:

   ```
   .github/hooks/telegram-loop-guard.json
   .github/hooks/telegram-loop-guard.ps1
   ```

   If you are setting up hooks in a **different project**, copy both files into that project's `.github/hooks/` directory.

2. **Restart VS Code** (or reload the window). VS Code auto-discovers hook files from `.github/hooks/` — no additional settings entry required.

### How it works

When Copilot Chat tries to end the agent conversation, VS Code fires the Stop hook before terminating. The hook:

1. Reads the hook event JSON from stdin.
2. Extracts the `cwd` to locate the VS Code workspace storage directory.
3. Finds the session memory folder under `GitHub.copilot-chat\memory-tool\memories\`.
4. Looks for `telegram-session.md` — if it exists and has content, the hook outputs a `decision: block` response.
5. VS Code keeps the agent alive and the agent is prompted to resume the dequeue loop.

The hook uses the `sessionId` from hook input (when available) to find the exact session memory directory. When `sessionId` is absent (VS Code omits it on some Stop events), it falls back to scanning all memory directories for a non-empty `telegram-session.md`.

### Session file

Agents must write their session credentials to `telegram-session.md` in their Copilot memory using the memory tool. The file should contain the session token, SID, and session name. The hook only blocks stop when this file has content — an empty file is treated as no active session.

---

## Claude Code

### Installation

1. **Copy the hook script** into your project's `.claude/hooks/` directory:

   ```
   .claude/hooks/telegram-loop-guard.sh
   ```

   This file ships in this repo. After copying, ensure it is executable:

   ```bash
   chmod +x .claude/hooks/telegram-loop-guard.sh
   ```

2. **Register the hook in `.claude/settings.local.json`**:

   ```json
   {
     "hooks": {
       "Stop": [
         {
           "matcher": "",
           "hooks": [
             {
               "type": "command",
               "command": ".claude/hooks/telegram-loop-guard.sh"
             }
           ]
         }
       ]
     }
   }
   ```

3. **Restart Claude Code** to activate the hook.

### How it works

When Claude Code is about to stop a session, it fires the Stop hook and reads stdout for a decision. The hook:

1. Reads the hook event JSON from stdin.
2. Checks `stop_hook_active` — if true, exits immediately to prevent an infinite loop.
3. Searches `~/.claude/projects/` for any `telegram/session.md` file with content.
4. If found, outputs a JSON block response with `decision: block`.
5. Claude Code keeps the session alive and the agent is prompted to resume the dequeue loop.

### Session file

Claude Code agents write their session credentials to a `telegram/session.md` file in the project memory directory (`~/.claude/projects/<project-hash>/memory/telegram/session.md`). The hook looks for any such file with content under `~/.claude/projects/`. An empty session file is treated as no active session.

---

## The dequeue loop pattern

Agents using this MCP must not exit between messages. The correct pattern is:

```text
action(type: "session/start") → drain (dequeue max_wait:0 until empty) → block (dequeue) → handle → drain → block → ...
```

- **Drain first** — call `dequeue(max_wait: 0)` in a loop until `empty: true` to clear any backlog.
- **Block** — call `dequeue()` (no args) to wait up to 300 seconds for the next message.
- **On timeout** — call `dequeue()` again immediately. Optionally send a brief check-in `send(type: "notification")`.
- **On message** — handle it, then drain, then block again.

**There is no exit condition.** The agent loops until it receives a shutdown signal or `action(type: "session/close")` is called. The loop guard enforces this at the host level — if the host tries to stop the agent while a session is active, the guard blocks it.

For full behavioral rules and tool usage patterns, see [`docs/behavior.md`](behavior.md).

---

## Troubleshooting

### Agent stopped unexpectedly / hook not firing

- In VS Code: check the Output panel for Copilot Chat hook errors. Confirm `.github/hooks/telegram-loop-guard.json` and `.ps1` are present in the repo.
- In Claude Code: confirm the hook is registered in `.claude/settings.local.json` and the `.sh` file has execute permission (`chmod +x`).
- Verify the session file exists and has content — an empty session file allows stop.

### Need to stop the agent intentionally

Clear the session file to allow the host to stop cleanly:

**VS Code (PowerShell):**

```powershell
# Find and clear your telegram-session.md
Set-Content -Path "<path-to-memories>\telegram-session.md" -Value ""
```

**Claude Code:**

```bash
# Clear the session file
> ~/.claude/projects/<project-hash>/memory/telegram/session.md
```

Once the file is empty, the hook exits 0 and the host can shut down the agent normally.

### Hook blocked stop but agent is unreachable

If the Telegram Bridge MCP server is down or unreachable, the agent may be blocked from stopping but unable to resume the loop. Clear the session file as described above to unblock the stop.

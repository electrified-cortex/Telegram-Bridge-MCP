# Customization Guide

This guide shows you how to use **Telegram Bridge MCP to develop and customize itself** — a self-hosting workflow where you give instructions via Telegram to modify code, behaviors, and documentation.

---

## Why This Works

Once configured, this MCP becomes your development assistant for its own codebase:

- **Your working directory IS the repo** — the MCP has full access to all source files
- **Loop prompt enforces best practices** — pre-action notifications, error reporting, test validation
- **Hot reload built-in** — `restart_server` tool rebuilds and restarts without breaking the session
- **Voice-driven coding** — speak instructions from anywhere, get status updates on your phone

---

## Setup: Self-Hosting Workflow

### 1. Clone and build

```bash
git clone https://github.com/electricessence/Telegram-Bridge-MCP.git
cd Telegram-Bridge-MCP
pnpm install
pnpm build
```

### 2. Pair your bot

```bash
pnpm pair
```

Follow the wizard to create `.env` with your bot credentials.

### 3. Configure your MCP host to use the local build

**VS Code** — `.vscode/mcp.json`:

```json
{
  "servers": {
    "telegram": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/absolute/path/to/Telegram-Bridge-MCP"
    }
  }
}
```

**Claude Desktop** — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": ["/absolute/path/to/Telegram-Bridge-MCP/dist/index.js"]
    }
  }
}
```

> **Important:** Use the **absolute path** to your local clone. The `cwd` (VS Code) or path in `args` ensures the MCP runs from your repo directory and can access `.env`.

### 4. Start a loop session

Open your AI assistant (VS Code Copilot, Claude Desktop, etc.) and paste the contents of `LOOP-PROMPT.md`. The assistant will:

1. Load the agent guide
2. Drain stale updates
3. Send a "Ready" message to Telegram
4. Enter a polling loop waiting for your instructions

---

## Development Workflow

### Basic flow

1. **Send instructions via Telegram** (text or voice)
2. The assistant acknowledges, analyzes, and takes action
3. File edits, test runs, and commands are **announced before execution** (silent notifications)
4. On errors, the assistant reports them and waits for direction
5. Repeat

### Example commands

**Edit behaviors:**
- "Add a new reaction convention to BEHAVIOR.md: 🔥 for critical errors"
- "Update LOOP-PROMPT.md to poll every 60 seconds instead of 300"

**Modify tools:**
- "Add optional `columns: 1 | 2` parameter to the `choose` tool"
- "Fix the newline escaping bug in `markdownToV2`"
- "Create a new tool `send_poll` for Telegram polls"

**Run tests and validate:**
- "Run all tests and report failures"
- "Run tests for `choose.test.ts` only"
- "Check for TypeScript errors"

**Build and restart:**
- "Rebuild and restart the server"
  - The `restart_server` tool runs `pnpm build`, restarts the MCP, drains stale updates, and resumes the loop

**Documentation:**
- "Add a new section to README explaining voice transcription setup"
- "Create a FAQ.md with common setup issues"

---

## Key Files for Customization

| File | What it controls |
|------|------------------|
| `BEHAVIOR.md` | Agent personality, tool usage conventions, formatting rules. Also served as the `telegram-bridge-mcp://agent-guide` MCP resource. |
| `FORMATTING.md` | Markdown/HTML/MarkdownV2 reference for message formatting. Served as `telegram-bridge-mcp://formatting-guide`. |
| `LOOP-PROMPT.md` | Your session startup script — the instructions you paste to begin a loop session. Customize this to change session behavior. |
| `SETUP.md` | Bot creation and pairing walkthrough. Served as `telegram-bridge-mcp://setup-guide`. |
| `src/tools/*.ts` | Individual MCP tool implementations. Each file = one tool. |
| `src/telegram.ts` | Core Telegram API wrapper, security enforcement, polling helpers. |
| `src/markdown.ts` | Markdown → MarkdownV2 auto-conversion logic. |
| `src/transcribe.ts` | Voice message transcription via local Whisper. |
| `src/server.ts` | MCP server definition, tool registration, resource registration. |

---

## Hot Reload with `restart_server`

After modifying TypeScript source files, call the `restart_server` tool (via the loop prompt, the assistant can do this automatically or you can request it):

```text
"Rebuild and restart the server"
```

**What happens:**

1. Runs `pnpm build` (compiles TypeScript)
2. Restarts the MCP server process
3. Calls `get_updates` twice to drain stale messages
4. Sends a "back online" notification
5. Returns to `wait_for_message` loop

**Important:** The loop prompt enforces that after a restart, the assistant immediately drains updates and re-engages. No session state is lost.

---

## Pre-Action Notifications

The loop prompt requires the assistant to send a **silent notification** before:

- Editing any source file (`src/*.ts`, `src/tools/*.ts`)
- Editing any test file (`*.test.ts`)
- Editing config/build files (`package.json`, `tsconfig.json`, etc.)
- Editing documentation (`BEHAVIOR.md`, `SETUP.md`, `FORMATTING.md`, `LOOP-PROMPT.md`, etc.)
- Running commands (`pnpm build`, `pnpm test`, `git commit`, etc.)
- Deleting any file

This gives you real-time visibility into what the assistant is doing, even when you're away from your computer.

**Example notification:**

```text
ℹ️ Editing src/tools/choose.ts
Adding button label length validation
```

---

## Error Handling

If a build fails, tests fail, or a command exits with a non-zero code:

1. The assistant **reports the error via Telegram**
2. Does **not** attempt further edits until you provide direction
3. Waits for clarification or a fix instruction

This prevents cascading failures and keeps you in control.

---

## Voice-Driven Development

All message-receiving tools (`wait_for_message`, `ask`, `choose`) support **automatic voice transcription** via local Whisper.

**Workflow:**

1. Open Telegram on your phone
2. Hold the microphone button and speak your instruction:  
   _"Add a timeout parameter to the ask tool, default 60 seconds"_
3. Release — the voice message is transcribed and sent to the assistant
4. The assistant acknowledges, edits `src/tools/ask.ts`, runs tests, confirms completion

No typing needed. Code from anywhere.

---

## Tips & Best Practices

### Keep tasks focused

Give one clear instruction at a time. The assistant will break it into steps if needed.

**Good:**
- "Add a `columns` parameter to the `choose` tool"

**Less clear:**
- "Fix the button layout issues and also update the docs and add tests"

### Use the `choose` tool for confirmations

If you ask a question that needs a decision, the assistant will present buttons via `choose`:

```text
Apply this change to choose.ts?
[Yes] [No] [Show diff first]
```

Tap your choice — no need to type.

### React to messages instead of replying "ok"

The assistant uses emoji reactions to acknowledge without noise:

- 👍 — noted
- 🫡 — task complete
- 👀 — seen
- 🎉 — success

You can do the same to confirm instructions.

### Use `update_status` for multi-step tasks

For complex tasks (e.g., "add a new tool with tests and docs"), the assistant can send a **live checklist** that updates as each step completes:

```text
Adding send_poll tool
✅ Created src/tools/send_poll.ts
⏳ Writing tests...
⬜ Update DESIGN.md
⬜ Rebuild and test
```

### Monitor silent notifications

If you're away from your computer, silent notifications let you track progress without being buzzed for every action.

---

## Example Session

**You (via Telegram voice):**  
_"Add a severity parameter to the notify tool, default to info"_

**Assistant:**
- 👀 reaction on your message
- 🔔 Silent notification: "Editing src/tools/notify.ts — adding severity parameter"
- Edits the file
- Runs `pnpm test`
- 🫡 "Done — `severity` parameter added, defaults to `info`, all tests pass"

**You:**  
_"Restart the server"_

**Assistant:**
- 🔔 "Restarting server"
- Runs `pnpm build`
- Restarts MCP
- 🔔 "Back online — build clean"

**You:**  
_"Send a test notification with severity: success"_

**Assistant sends:**

```text
✅ Test Notification
This is a success notification.
```

---

## Customizing Agent Behavior

The assistant's personality and tool usage conventions are defined in `BEHAVIOR.md`. You can modify this file to:

- Change reaction emoji conventions
- Add new proactive notification rules
- Adjust timeout strategies
- Define new tool usage patterns

**Example:**

```markdown
## Tool usage: `send_photo`

Always send photos with captions unless told otherwise.
Default `parse_mode` is Markdown for captions.
```

After editing `BEHAVIOR.md`, the changes take effect immediately — the assistant re-reads the guide at the start of each session (or you can ask it to reload: _"Re-read the agent guide"_).

---

## Customizing the Loop Prompt

`LOOP-PROMPT.md` defines the session startup sequence and loop rules. You can modify it to:

- Change polling timeout (default 300 s)
- Add custom startup actions (e.g., "check for git updates")
- Change exit condition (default: `exit`)
- Add new pre-action rules

After editing, paste the new version into your AI assistant to start a session with the updated behavior.

---

## FAQ

### Can I use this workflow for other projects?

Yes — the loop prompt is generic. Point the MCP `cwd` to any repo and the assistant can work on it via Telegram. Just copy `LOOP-PROMPT.md` and adjust the file/command rules for your project.

### What if I break the MCP code?

Revert your changes via git, rebuild, and restart:

```bash
git checkout src/tools/broken-file.ts
pnpm build
# Restart your MCP host (restart VS Code or Claude Desktop)
```

Or give the instruction via Telegram before things break too badly: _"Revert the last commit and rebuild"_

### Can I share my customizations?

Absolutely — fork the repo, make your changes, and publish your fork. Or submit a pull request if you've added something useful.

---

## Next Steps

- Read `BEHAVIOR.md` to understand the agent's personality and conventions
- Read `LOOP-PROMPT.md` to see the full session startup sequence
- Try a simple edit: _"Add a new emoji reaction to BEHAVIOR.md"_
- Experiment with voice commands on your phone

---

**Happy self-hosting!** 🚀

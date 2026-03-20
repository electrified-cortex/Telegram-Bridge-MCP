# Task 017 — Pre/Post-Compaction Hooks (Spike)

**Type:** Spike / Research
**Priority:** 35 (medium)
**Status:** Complete

## Findings

### 1. VS Code API hooks — None exist

The VS Code extension API (`ChatContext`, `ChatParticipant`, language model interfaces) has no events, hooks, or callbacks for conversation compaction/summarization. Compaction is internal to the GitHub Copilot extension — it happens in the LLM orchestration layer before/after calls, with no extension API visibility.

**Feasibility: None** — no API surface exists.

### 2. MCP protocol — Connection survives; server can detect but not wake

- Compaction ≠ disconnect. The stdio transport stays alive. The MCP server process and session remain valid.
- MCP is client-initiated for tool calls. The server cannot trigger tools on the client side.
- Server notifications (`sendLoggingMessage`, `sendToolListChanged`) inform the VS Code MCP runtime, not the LLM agent — they don't trigger re-engagement.
- **Already built:** `health-check.ts` detects stale sessions (10-min threshold) and alerts the operator via Telegram with interactive recovery options.

**Feasibility: Already implemented** for detection/alerting. Proactive wake is protocol-impossible.

### 3. Prompt-level mitigation — Best available vector

`.github/copilot-instructions.md` and `.instructions.md` files (via `applyTo: "**"`) survive compaction — they're injected into every turn. This is the only mechanism that both survives compaction AND can influence agent behavior.

**Action taken:** Added a "Post-Compaction Recovery" section to `copilot-instructions.md` with instructions for the agent to detect compaction and re-engage the loop.

**Feasibility: High** — most practical approach. No code changes needed.

### 4. Server-side keepalive — Already implemented

`health-check.ts` runs every 60s, detects session staleness, alerts operator. Combined with prompt-level recovery instructions, this creates defense-in-depth.

**Feasibility: Already built.**

## Recommendation

| Layer | Mechanism | Status |
| --- | --- | --- |
| Detection | health-check.ts (10-min threshold) | ✅ Already works |
| Operator alerting | Telegram notification with recovery options | ✅ Already works |
| Agent self-recovery | copilot-instructions.md recovery section | ✅ Added |
| VS Code API hooks | No API exists | ❌ Not possible |
| Server→agent wake | MCP protocol limitation | ❌ Not possible |

**Future possibility:** A companion VS Code extension that monitors MCP server health and re-triggers the agent. Medium effort, low priority given existing mitigations work.

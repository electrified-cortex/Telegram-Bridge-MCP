# Channels — Status & Configuration

**Status as of 2026-05-22: implemented in TMCP, not wired through in our HTTP deployment. Channels do not currently wake agents.**

Use `dequeue` (blocking long-poll) as the wake mechanism. Channels are present in the code for future use but do not function in the default streamable-HTTP setup.

## What channels are

A Claude Code research-preview feature (CC v2.1.80+, March 2026) where an MCP server pushes events directly into the agent's context as `<channel source="...">` tags. The notification interrupts CC's wait state and starts a new turn — no polling, no dequeue.

Reference: https://code.claude.com/docs/en/channels-reference

## What TMCP has implemented

- Server declares `capabilities.experimental['claude/channel']` (see `src/server.ts`).
- On every new inbound event, `src/channel.ts` fires `notifications/claude/channel` with content + meta alongside the standard `notifications/resources/updated`.
- URI scheme for subscriptions: `telegram://inbox/<token>`.
- Per-session cooldown model: at most one channel notification per kick-lockout window.

This code path is exercised when a session has an active channel subscription registered (`registerChannelSubscriber`). It does no harm when unused — capability declaration is metadata-only, and the extra notification is delivered into the void with no listener.

## Why channels do not wake CC in the default deployment

CC's channel wake interrupt is wired to **stdio transport only**. Anthropic's published model:

> "A channel is an MCP server that runs on the same machine as Claude Code. Claude Code spawns it as a subprocess and communicates over stdio."

Our `.mcp.json` uses the streamable-HTTP transport:

```json
{
  "mcpServers": {
    "telegram-bridge-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:3099/mcp"
    }
  }
}
```

When `notifications/claude/channel` arrives via the HTTP GET `/mcp` SSE stream, CC receives it but does not treat it as a wake interrupt. **Empirically verified 2026-05-22**: with `--dangerously-load-development-channels=server:telegram-bridge-mcp` set and the capability declared, an inbound Telegram message was queued normally but did not wake the idle agent. Only manual dequeue retrieved it.

## What it would take to enable channels

Two pieces, both required:

1. **Switch to a stdio transport per session.** Each agent's `.mcp.json` would use `command:` instead of `url:`, spawning a launcher subprocess (e.g. `src/launcher.ts`, a stdio<->HTTP bridge):

   ```json
   {
     "mcpServers": {
       "telegram-bridge-mcp": {
         "command": "node",
         "args": ["/abs/path/to/Telegram-Bridge-MCP/dist/launcher.js"]
       }
     }
   }
   ```

   The central TMCP HTTP server keeps running; each agent gets a per-session stdio bridge to it. Multi-agent and per-token sessions are preserved.

2. **Pass the development flag at CC startup.** Custom (non-Anthropic-allowlist) channel servers require:

   ```
   claude --dangerously-load-development-channels=server:telegram-bridge-mcp ...
   ```

   The `=` syntax is required when other positional arguments follow, or the flag consumes them as additional channel entries.

## Why we are not currently pursuing this

Streamable HTTP is the primary transport. It supports multi-agent connections to a central TMCP service, which is incompatible with the per-session stdio subprocess model the channel feature requires. Adding a per-session stdio bridge to enable channel wake was evaluated and declined 2026-05-22 — the existing `dequeue` long-poll + monitor pattern is the supported wake mechanism for this deployment.

The implementation remains in the codebase so a future operator who prefers the stdio model (or single-agent use) can opt in without code changes — only the `.mcp.json` transport and the CC startup flag need to change.

## See also

- `help(topic: 'dequeue')` — the supported wake mechanism today
- `help(topic: 'startup')` — onboarding hint references inbox subscription URI
- Anthropic docs: https://code.claude.com/docs/en/channels-reference

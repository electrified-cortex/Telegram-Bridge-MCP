import "dotenv/config";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { getSecurityConfig, getApi, resolveChat, installOutboundProxy, sendServiceMessage, restorePollerOffset } from "./telegram.js";
import { clearCommandsOnShutdown } from "./shutdown.js";
import { BUILT_IN_COMMANDS, applySessionLogConfig, doTimelineDump } from "./built-in-commands.js";
import { startPoller, stopPoller, drainPendingUpdates, waitForPollerExit } from "./poller.js";
import { startHealthCheck } from "./health-check.js";
import { setAuthHook } from "./session-gate.js";
import { touchSession, getSessionReauthDialogMsgId, clearSessionReauthDialogMsgId, restoreSessionsFromSnapshot, restoreSessions, listSessions } from "./session-manager.js";
import { setPlannedBounce } from "./bounce-state.js";
import { createOutboundProxy } from "./outbound-proxy.js";
import { loadConfig, getSessionLogMode, isDebugConfig, getPreToolDenyPatterns, getSessionApproval } from "./config.js";
import { loadSessionState, clearSessionState, expireRestoredSessions } from "./session-persistence.js";
import { setGovernorSid } from "./routing-mode.js";
import { createSessionQueue } from "./session-queue.js";
import { setDelegationEnabled } from "./agent-approval.js";
import { setPreToolHook, buildDenyPatternHook } from "./tool-hooks.js";
import { timelineSize, setOnLocalLog } from "./message-store.js";
import { initDebugLog } from "./debug-log.js";
import { cleanupStalePins } from "./startup-pin-cleanup.js";
import { resolveHttpPort } from "./cli-args.js";
import { enableLogging, isLoggingEnabled, rollLog, logEvent as logLocalEvent, flushCurrentLog } from "./local-log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as { name: string; version: string };
process.stderr.write(`[info] [${pkg.name}] v${pkg.version} starting...\n`);

// Initialize security config early so warnings surface at startup
getSecurityConfig();

// Load persistent MCP config
loadConfig();

// Restore session-manager state from bounce-state file (fast-restart protocol)
{
  const isPlanned = restoreSessions();
  setPlannedBounce(isPlanned);
  // Ensure queues exist for every restored session
  for (const session of listSessions()) {
    createSessionQueue(session.sid);
  }
  if (isPlanned) {
    process.stderr.write(`[startup] planned bounce detected — reconnect approval will be skipped\n`);
  }
}

// Restore session state from a prior planned bounce, if available
{
  const snapshot = loadSessionState();
  if (snapshot) {
    restoreSessionsFromSnapshot(snapshot.sessions);
    setGovernorSid(snapshot.governorSid);
    restorePollerOffset(snapshot.pollerOffset);
    clearSessionState();
    process.stderr.write(`[startup] restored ${snapshot.sessions.length} session(s) from snapshot\n`);
    // Ensure queues exist for every session restored from the snapshot
    for (const session of listSessions()) {
      createSessionQueue(session.sid);
    }
    // Expire the restored-session bypass after 5 minutes so stale snapshots
    // cannot permanently bypass operator approval.
    setTimeout(() => void expireRestoredSessions(), 5 * 60 * 1000);
  }
}

// Auto-enable delegation if configured
if (getSessionApproval() === "governor") {
  setDelegationEnabled(true);
  process.stderr.write("[info] session approval: governor — delegation auto-enabled\n");
}

// Initialize debug logging from config (or env var fallback)
initDebugLog(isDebugConfig());

// Register deny-pattern hook from config (if any patterns are configured)
const _denyPatterns = getPreToolDenyPatterns();
if (_denyPatterns.length > 0) {
  setPreToolHook(buildDenyPatternHook(_denyPatterns));
  process.stderr.write(`[info] pre-tool hook: ${_denyPatterns.length} deny pattern(s) loaded\n`);
}
if (isDebugConfig()) process.stderr.write("[info] debug logging enabled\n");

// Warn if TTS/STT remote hosts are using plain HTTP (credentials and audio exposed in transit)
if (process.env.TTS_HOST && !process.env.TTS_HOST.startsWith("https://")) {
  process.stderr.write("[warn] TTS_HOST is not using HTTPS — credentials and audio may be exposed in transit.\n");
}
if (process.env.STT_HOST && !process.env.STT_HOST.startsWith("https://")) {
  process.stderr.write("[warn] STT_HOST is not using HTTPS — credentials and audio may be exposed in transit.\n");
}

let _shuttingDown = false;
const httpTransports = new Map<string, StreamableHTTPServerTransport>();

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    process.stderr.write(`[shutdown] received ${sig}\n`);
    if (_shuttingDown) return;
    _shuttingDown = true;
    stopPoller();
    const shutdownSequence = (async () => {
      // Close all HTTP transports
      for (const [sid, t] of httpTransports) {
        try { await t.close(); } catch { /* best effort */ }
        httpTransports.delete(sid);
      }
      // Wait for the poll loop to finish (completes in-flight transcriptions)
      await waitForPollerExit();
      // Drain any updates received since the last poll iteration
      const drained = await drainPendingUpdates();
      if (drained > 0) process.stderr.write(`[shutdown] drained ${drained} pending update(s)\n`);
      // Roll the active log on shutdown so the current session log is cleanly archived.
      // Flush before timeline dump to prevent double-roll (doTimelineDump also calls rollLog).
      if (isLoggingEnabled()) {
        try { await flushCurrentLog(); } catch { /* best effort */ }
      }
      if (getSessionLogMode() !== null && timelineSize() > 0) {
        try { doTimelineDump(); } catch { /* best effort */ }
      } else if (isLoggingEnabled()) {
        try { rollLog(); } catch { /* best effort */ }
      }
      await sendServiceMessage("🔴 Offline").catch((e: unknown) => {
        process.stderr.write(`[shutdown] sendServiceMessage error: ${String(e)}\n`);
      });
    })();
    const timeout = new Promise<void>((r) => setTimeout(r, 10000));
    void Promise.race([shutdownSequence, timeout])
      .finally(() => clearCommandsOnShutdown().finally(() => process.exit(0)));
  });
}

// Install the outbound proxy before any API calls
installOutboundProxy(createOutboundProxy);

// Apply session log config (wires up auto-dump if configured)
applySessionLogConfig();

// Wire up always-on local logging (default: enabled, opt-out via disableLogging())
enableLogging();
setOnLocalLog((event) => {
  // Strip raw Telegram update before logging — it's verbose and contains PII
  const { _update: _discarded, ...loggableEvent } = event;
  logLocalEvent(loggableEvent);
});

// Parse --http [port] from argv (takes precedence over MCP_PORT env var)
let mcpPort: number | undefined;
try {
  mcpPort = resolveHttpPort(process.argv, process.env);
} catch (e) {
  process.stderr.write(`[error] ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}

if (mcpPort !== undefined) {
  // ── Streamable HTTP mode (shared server, multiple clients) ──
  const app = createMcpExpressApp();

  /** Normalize header that may be string | string[] | undefined → string | undefined */
  const getSessionId = (req: Request): string | undefined => {
    const raw = req.headers["mcp-session-id"];
    return Array.isArray(raw) ? raw[0] : raw;
  };

  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    let transport: StreamableHTTPServerTransport;

    const existing = sessionId ? httpTransports.get(sessionId) : undefined;
    if (existing) {
      transport = existing;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          process.stderr.write(`[http] session initialized: ${sid}\n`);
          httpTransports.set(sid, transport);
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && httpTransports.has(sid)) {
          process.stderr.write(`[http] session closed: ${sid}\n`);
          httpTransports.delete(sid);
        }
      };
      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      // Extract the request id (if present) so clients can correlate the error per JSON-RPC 2.0
      let requestId: string | number | null = null;
      const body: unknown = req.body;
      if (body !== null && typeof body === "object" && !Array.isArray(body) && "id" in body) {
        const candidate = (body as Record<string, unknown>).id;
        if (typeof candidate === "string" || typeof candidate === "number" || candidate === null) {
          requestId = candidate;
        }
      }
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: requestId,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const transport = sessionId ? httpTransports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = getSessionId(req);
    const transport = sessionId ? httpTransports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transport.handleRequest(req, res);
  });

  app.listen(mcpPort, "127.0.0.1", () => {
    process.stderr.write(`[info] MCP Streamable HTTP server listening on http://127.0.0.1:${mcpPort}/mcp\n`);
  });
} else {
  // ── stdio mode (original behavior) ──
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[info] MCP stdio transport connected\n");
}

// Register built-in commands and start the background poller after server startup.
// In HTTP mode this may happen before any MCP client connects. Both are best-effort — don't block startup.
void (async () => {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  try {
    await getApi().setMyCommands([...BUILT_IN_COMMANDS], {
      scope: { type: "chat", chat_id: chatId },
    });
  } catch { /* ignore */ }
})();

// Start the background poller unconditionally so built-in Telegram commands
// (e.g. /shutdown, /session) work even when no agent session is active.
startPoller();

startHealthCheck();
setAuthHook((sid: number) => {
  touchSession(sid);
  const reauthMsgId = getSessionReauthDialogMsgId(sid);
  if (reauthMsgId !== undefined) {
    clearSessionReauthDialogMsgId(sid);
    const chatId = resolveChat();
    if (typeof chatId === "number") {
      getApi().deleteMessage(chatId, reauthMsgId).catch(() => {});
    }
  }
});
process.stderr.write("[info] health check started\n");

// Best-effort: unpin stale session announcement messages from a prior crashed run
void cleanupStalePins().catch(() => {});

// Best-effort startup notification — bypasses proxy (operational, not agent content)
const localLogStatus = isLoggingEnabled() ? "`Logging enabled`" : "Logging disabled";
void sendServiceMessage(`🟢 Online\n${localLogStatus}\n/logging to change settings`).catch(() => {});

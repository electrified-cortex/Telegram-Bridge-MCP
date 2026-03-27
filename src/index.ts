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
import { getSecurityConfig, getApi, resolveChat, installOutboundProxy, sendServiceMessage } from "./telegram.js";
import { clearCommandsOnShutdown } from "./shutdown.js";
import { BUILT_IN_COMMANDS, applySessionLogConfig, doTimelineDump } from "./built-in-commands.js";
import { stopPoller, drainPendingUpdates, waitForPollerExit } from "./poller.js";
import { startHealthCheck } from "./health-check.js";
import { setAuthHook } from "./session-gate.js";
import { touchSession } from "./session-manager.js";
import { createOutboundProxy } from "./outbound-proxy.js";
import { loadConfig, getSessionLogMode, sessionLogLabel, isDebugConfig } from "./config.js";
import { timelineSize } from "./message-store.js";
import { initDebugLog } from "./debug-log.js";
import { cleanupStalePins } from "./startup-pin-cleanup.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as { name: string; version: string };
process.stderr.write(`[info] [${pkg.name}] v${pkg.version} starting...\n`);

// Initialize security config early so warnings surface at startup
getSecurityConfig();

// Load persistent MCP config
loadConfig();

// Initialize debug logging from config (or env var fallback)
initDebugLog(isDebugConfig());
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
      // Dump session log before exit (if not disabled)
      if (getSessionLogMode() !== null && timelineSize() > 0) {
        try { await doTimelineDump(); } catch { /* best effort */ }
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

const rawMcpPort = process.env.MCP_PORT;
let mcpPort: number | undefined;

if (typeof rawMcpPort === "string" && rawMcpPort.length > 0) {
  const parsed = parseInt(rawMcpPort, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    process.stderr.write(`[error] Invalid MCP_PORT "${rawMcpPort}". Expected an integer between 1 and 65535.\n`);
    process.exit(1);
  }
  mcpPort = parsed;
}

if (mcpPort) {
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

startHealthCheck();
setAuthHook(touchSession);
process.stderr.write("[info] health check started\n");

// Best-effort: unpin stale session announcement messages from a prior crashed run
void cleanupStalePins().catch(() => {});

// Best-effort startup notification — bypasses proxy (operational, not agent content)
const logStatus = sessionLogLabel();
void sendServiceMessage(`🟢 Online\nSession record: ${logStatus}\n/session to change settings`).catch(() => {});

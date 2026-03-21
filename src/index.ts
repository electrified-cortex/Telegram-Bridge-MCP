import "dotenv/config";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { getSecurityConfig, getApi, resolveChat, installOutboundProxy, sendServiceMessage } from "./telegram.js";
import { clearCommandsOnShutdown } from "./shutdown.js";
import { BUILT_IN_COMMANDS, applySessionLogConfig, doTimelineDump } from "./built-in-commands.js";
import { startPoller, stopPoller, drainPendingUpdates, waitForPollerExit } from "./poller.js";
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
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    process.stderr.write(`[shutdown] received ${sig}\n`);
    if (_shuttingDown) return;
    _shuttingDown = true;
    stopPoller();
    const shutdownSequence = (async () => {
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

const server = createServer();

// Install the outbound proxy before any API calls
installOutboundProxy(createOutboundProxy);

// Apply session log config (wires up auto-dump if configured)
applySessionLogConfig();

const transport = new StdioServerTransport();

await server.connect(transport);

// Register built-in commands and start the background poller after connecting.
// Both are best-effort — don't block startup.
void (async () => {
  const chatId = resolveChat();
  if (typeof chatId !== "number") return;
  try {
    await getApi().setMyCommands([...BUILT_IN_COMMANDS], {
      scope: { type: "chat", chat_id: chatId },
    });
  } catch { /* ignore */ }
})();

startPoller();
process.stderr.write("[info] background poller started\n");

startHealthCheck();
setAuthHook(touchSession);
process.stderr.write("[info] health check started\n");

// Best-effort: unpin stale session announcement messages from a prior crashed run
void cleanupStalePins().catch(() => {});

// Best-effort startup notification — bypasses proxy (operational, not agent content)
const logStatus = sessionLogLabel();
void sendServiceMessage(`🟢 Online\nSession record: ${logStatus}\n/session to change settings`).catch(() => {});

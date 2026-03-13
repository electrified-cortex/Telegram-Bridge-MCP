import "dotenv/config";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { getSecurityConfig, getApi, resolveChat, installOutboundProxy } from "./telegram.js";
import { clearCommandsOnShutdown } from "./shutdown.js";
import { BUILT_IN_COMMANDS } from "./built-in-commands.js";
import { startPoller, stopPoller } from "./poller.js";
import { createOutboundProxy } from "./outbound-proxy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as { name: string; version: string };
process.stderr.write(`[info] [${pkg.name}] v${pkg.version} starting...\n`);

// Initialize security config early so warnings surface at startup
getSecurityConfig();

// Warn if TTS/STT remote hosts are using plain HTTP (credentials and audio exposed in transit)
if (process.env.TTS_HOST && !process.env.TTS_HOST.startsWith("https://")) {
  process.stderr.write("[warn] TTS_HOST is not using HTTPS — credentials and audio may be exposed in transit.\n");
}
if (process.env.STT_HOST && !process.env.STT_HOST.startsWith("https://")) {
  process.stderr.write("[warn] STT_HOST is not using HTTPS — credentials and audio may be exposed in transit.\n");
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    stopPoller();
    void clearCommandsOnShutdown().finally(() => process.exit(0));
  });
}

const server = createServer();

// Install the outbound proxy before any API calls
installOutboundProxy(createOutboundProxy);

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

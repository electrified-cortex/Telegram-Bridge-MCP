import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config as dotenvConfig } from "dotenv";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// Load .env from the package root before anything else
dotenvConfig({ path: join(projectRoot, ".env") });

const DEFAULT_PORT = 3099;
const MCP_PATH = "/mcp";
const PROBE_TIMEOUT_MS = 2000;
const WAIT_INTERVAL_MS = 250;
const WAIT_TIMEOUT_MS = 15000;

function getMcpPort(): number {
  const raw = process.env.MCP_PORT;
  if (raw !== undefined && raw.length > 0) {
    const parsed = parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) return parsed;
  }
  return DEFAULT_PORT;
}

async function probeServer(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "probe", method: "ping" }),
    });
    if (res.status >= 500) return false;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) return false;
    const data = (await res.json()) as Record<string, unknown>;
    return data.jsonrpc === "2.0" && ("result" in data || "error" in data);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => { setTimeout(r, WAIT_INTERVAL_MS); });
    if (await probeServer(url, PROBE_TIMEOUT_MS)) return;
  }
  throw new Error(`[launcher] server did not become ready within ${WAIT_TIMEOUT_MS}ms`);
}

async function startServer(port: number): Promise<void> {
  process.stderr.write(`[launcher] starting server on port ${port}...\n`);
  // CRITICAL: chdir before importing index.js so that dotenv/config (in index.js)
  // finds .env relative to process.cwd()
  process.chdir(projectRoot);
  process.env.MCP_PORT = String(port);
  await import("./index.js");
  await waitForServer(`http://127.0.0.1:${port}${MCP_PATH}`);
  process.stderr.write("[launcher] server ready\n");
}

async function readSse(res: Response): Promise<void> {
  const reader = res.body?.getReader();
  if (reader === undefined) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value as Uint8Array, { stream: true });
    let lineEnd: number;
    while ((lineEnd = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, lineEnd).trimEnd();
      buffer = buffer.slice(lineEnd + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const msg = JSON.parse(data) as JSONRPCMessage;
        process.stdout.write(serializeMessage(msg));
      } catch {
        // skip malformed SSE data frames
      }
    }
  }
  // Drain any trailing data not terminated by newline
  const trailing = buffer.trimEnd();
  if (trailing.startsWith("data:")) {
    const data = trailing.slice(5).trim();
    if (data.length > 0 && data !== "[DONE]") {
      try {
        const msg = JSON.parse(data) as JSONRPCMessage;
        process.stdout.write(serializeMessage(msg));
      } catch {
        // skip malformed trailing frame
      }
    }
  }
}

function bridge(port: number): void {
  const baseUrl = `http://127.0.0.1:${port}${MCP_PATH}`;
  const readBuffer = new ReadBuffer();
  let sessionId: string | undefined;

  async function postMessage(message: JSONRPCMessage): Promise<void> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (sessionId !== undefined) headers["mcp-session-id"] = sessionId;

    const res = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    });

    const sid = res.headers.get("mcp-session-id");
    if (sid !== null) sessionId = sid;

    // 202 Accepted means the notification was received — no body to relay
    if (res.status === 202) return;

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.startsWith("text/event-stream")) {
      await readSse(res);
    } else if (contentType.startsWith("application/json")) {
      const json = (await res.json()) as JSONRPCMessage;
      process.stdout.write(serializeMessage(json));
    } else if (contentType.length > 0) {
      process.stderr.write(`[launcher] unexpected content-type "${contentType}" — response dropped\n`);
    }
  }

  // Serialize postMessage calls so session ID from initialize response
  // is captured before subsequent messages are sent.
  let messageQueue = Promise.resolve();

  process.stdin.on("data", (chunk: Buffer) => {
    readBuffer.append(chunk);
    let msg: JSONRPCMessage | null;
    while ((msg = readBuffer.readMessage()) !== null) {
      const captured = msg;
      messageQueue = messageQueue
        .then(() => postMessage(captured))
        .catch((err: unknown) => {
          process.stderr.write(`[launcher] bridge error: ${String(err)}\n`);
        });
    }
  });

  process.stdin.on("end", () => {
    process.stderr.write("[launcher] stdin closed, exiting\n");
    process.exit(0);
  });
}

const port = getMcpPort();
const probeUrl = `http://127.0.0.1:${port}${MCP_PATH}`;
const running = await probeServer(probeUrl, PROBE_TIMEOUT_MS);

if (running) {
  process.stderr.write(`[launcher] server already running on port ${port}, connecting...\n`);
} else {
  await startServer(port);
}

bridge(port);

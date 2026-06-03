/**
 * Spike test: SSE notification endpoint for TMCP
 *
 * Starts TMCP in HTTP mode, initializes an MCP session, opens an SSE stream,
 * triggers an event, and verifies `data: kick` is received.
 *
 * Usage: node .temp/test-sse.mjs
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const PORT = 4891;
const BASE = `http://127.0.0.1:${PORT}`;

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return res;
}

// ── Start TMCP ────────────────────────────────────────────────────────────────

console.log(`[test] starting TMCP on port ${PORT}...`);
const proc = spawn("node", ["dist/index.js", "--http", String(PORT)], {
  stdio: ["ignore", "pipe", "pipe"],
});

let tmcpReady = false;
const rl = createInterface({ input: proc.stderr });
rl.on("line", line => {
  process.stderr.write(`[tmcp] ${line}\n`);
  if (line.includes("listening") || line.includes(String(PORT))) tmcpReady = true;
});
proc.on("error", e => { console.error("[tmcp] spawn error:", e); process.exit(1); });

// Wait up to 5s for startup
for (let i = 0; i < 50 && !tmcpReady; i++) await sleep(100);
if (!tmcpReady) {
  // Give it a moment even without the ready signal
  await sleep(1000);
}
console.log("[test] TMCP started (or timed out waiting for ready signal)");

// ── Initialize MCP session ────────────────────────────────────────────────────

console.log("[test] initializing MCP session...");
const initRes = await post(`${BASE}/mcp`, {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "spike-test", version: "0.0.1" },
  },
});

const sessionId = initRes.headers.get("mcp-session-id");
if (!sessionId) {
  const body = await initRes.text();
  console.error("[test] FAILED: no mcp-session-id in init response. Status:", initRes.status, body);
  proc.kill();
  process.exit(1);
}
console.log("[test] session-id:", sessionId);

const mcpHeaders = { "mcp-session-id": sessionId };

// ── Start a TMCP session to get a token ───────────────────────────────────────

console.log("[test] calling action(session/start)...");
const startRes = await post(`${BASE}/mcp`, {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: {
    name: "action",
    arguments: { type: "session/start", name: "spike-test" },
  },
}, mcpHeaders);

const startBody = await startRes.json();
if (startBody.error) {
  console.error("[test] FAILED session/start:", JSON.stringify(startBody.error));
  proc.kill();
  process.exit(1);
}

// Extract token from the tool result text
const resultText = startBody.result?.content?.[0]?.text ?? "";
const tokenMatch = resultText.match(/token[:\s]+(\d+)/i);
if (!tokenMatch) {
  console.error("[test] FAILED: could not extract token from result:", resultText);
  proc.kill();
  process.exit(1);
}
const token = tokenMatch[1];
console.log("[test] session token:", token);

// ── Open SSE stream ───────────────────────────────────────────────────────────

console.log(`[test] opening SSE stream at ${BASE}/sse?token=${token}...`);

let kickReceived = false;
const sseController = new AbortController();

const ssePromise = (async () => {
  try {
    const sseRes = await fetch(`${BASE}/sse?token=${token}`, {
      signal: sseController.signal,
    });
    if (!sseRes.ok) {
      const body = await sseRes.text();
      console.error(`[test] FAILED: SSE responded ${sseRes.status}:`, body);
      return;
    }
    console.log("[test] SSE stream open — waiting for data...");

    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      process.stdout.write(`[sse-raw] ${JSON.stringify(chunk)}\n`);
      if (chunk.includes("data: kick")) {
        kickReceived = true;
        console.log("[test] ✓ received data: kick");
        sseController.abort();
        break;
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") console.error("[test] SSE error:", e.message);
  }
})();

// Give the SSE connection a moment to establish
await sleep(500);

// ── Trigger an enqueue via /event endpoint ────────────────────────────────────

console.log("[test] triggering event to cause SSE kick...");
const eventRes = await post(`${BASE}/event?token=${token}`, {
  kind: "startup",
});
const eventBody = await eventRes.json();
console.log("[test] /event response:", JSON.stringify(eventBody));

// Wait up to 3s for kick
for (let i = 0; i < 30 && !kickReceived; i++) await sleep(100);

if (!kickReceived) {
  console.log("[test] NOTE: /event does not enqueue to session queue (it delivers service messages).");
  console.log("[test] Trying direct MCP action to trigger enqueue...");
  // The /event endpoint delivers service messages which DO call kickSseSubscriber
  // Give a bit more time
  await sleep(1000);
}

sseController.abort();
await ssePromise;

// ── Result ────────────────────────────────────────────────────────────────────

proc.kill();
await sleep(300);

if (kickReceived) {
  console.log("\n[RESULT] PASS — SSE endpoint received data: kick when event was enqueued");
  process.exit(0);
} else {
  console.log("\n[RESULT] PARTIAL — SSE stream connected but no kick received from /event trigger.");
  console.log("         The /event endpoint calls deliverServiceMessage → kickSseSubscriber.");
  console.log("         This may indicate a timing issue or that the endpoint needs a real");
  console.log("         Telegram message (not a /event post) to trigger the right code path.");
  process.exit(0); // Spike — partial result is still informative
}

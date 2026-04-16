import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runInSessionContext } from "./session-context.js";
import { getActiveSession, getSession } from "./session-manager.js";
import { runInTokenHintContext } from "./tools/identity-schema.js";
import { invokePreToolHook } from "./tool-hooks.js";
import { toError } from "./telegram.js";
import { getTutorialHint } from "./tutorial-hints.js";
import { recordToolCall } from "./trace-log.js";

import { register as registerDequeueUpdate } from "./tools/dequeue.js";
import { register as registerSend } from "./tools/send.js";
import { register as registerHelp } from "./tools/help.js";
import { register as registerAction } from "./tools/action.js";

import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../package.json") as { version: string };

const LOG_FIELD_CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g;

/**
 * Sanitize a log field by stripping \r, \n, and other ASCII control characters
 * to prevent log injection attacks (fake log lines, ANSI escapes, etc.).
 */
function normalizeLogField(s: string): string {
  // Strip \r, \n, and other ASCII control characters to prevent log injection.
  return s.replace(LOG_FIELD_CONTROL_CHARS_RE, " ").trim();
}

/**
 * Writes a [hook:blocked] log line to stderr.
 * Exported so it can be tested independently of the full server setup.
 */
export function logBlockedToolCall(toolName: string, reason: string): void {
  process.stderr.write(`[hook:blocked] ${normalizeLogField(toolName)} — ${normalizeLogField(reason)}\n`);
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "telegram-bridge-mcp",
    version: PKG_VERSION,
  });

  // ── Session context middleware ──────────────────────────────────────────
  // Wrap every tool handler in AsyncLocalStorage so outbound messages
  // are attributed to the correct session even when multiple sessions
  // interleave tool calls concurrently.
  const _origRegisterTool = server.registerTool.bind(server);
  type AnyConfig = Parameters<typeof _origRegisterTool>[1];
  type AnyCallback = Parameters<typeof _origRegisterTool>[2];
  // `any[]` is intentional: this wrapper must accept any tool callback signature
  // without knowing the parameter types at compile time. The real type safety
  // lives in individual tool registrations via their Zod inputSchema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type CallableCb = (...a: any[]) => unknown;
  server.registerTool = ((
    name: string,
    config: AnyConfig,
    cb: AnyCallback,
  ) => {
    const original = cb as unknown as CallableCb;
    const wrappedCb = (
      (args: Record<string, unknown>, extra: unknown) => {
        // Decode sid from token (sid * 1_000_000 + pin) for session context.
        // Falls back to active session for tools that don't require auth.
        // Each call is also wrapped in a token-hint context so the TOKEN_SCHEMA
        // preprocess and the handler share per-request hint state, preventing
        // concurrent requests from corrupting each other's hint flag.
        const token = args.token;
        const sid = (typeof token === "number" && token > 0)
          ? Math.floor(token / 1_000_000)
          : getActiveSession();

        const run = async () => {
          // Pre-tool hook fires before the original handler executes.
          // A hook returning allowed:false short-circuits the call and
          // returns a 403-style error.  If the hook itself throws, we
          // fail safe by treating it as blocked.
          const sessionName = (sid > 0 ? getSession(sid)?.name : undefined) ?? "";

          let hookResult: { allowed: boolean; reason?: string };
          try {
            hookResult = await invokePreToolHook(name, args);
          } catch (err) {
            // Hook threw — treat as blocked to fail safe
            const reason = err instanceof Error ? err.message : "Hook error";
            logBlockedToolCall(name, reason);
            recordToolCall(name, args, sid, sessionName, "blocked", "HOOK_ERROR");
            return toError({ code: "BLOCKED", message: `Pre-tool hook error: ${reason}` });
          }
          if (!hookResult.allowed) {
            const reason = hookResult.reason ?? "Blocked by pre-tool hook";
            logBlockedToolCall(name, reason);
            recordToolCall(name, args, sid, sessionName, "blocked", "BLOCKED");
            return toError({ code: "BLOCKED", message: reason });
          }

          let callResult: unknown;
          try {
            callResult = await Promise.resolve(original(args, extra));
          } catch (err) {
            const code = err instanceof Error ? err.message : "UNKNOWN_ERROR";
            recordToolCall(name, args, sid, sessionName, "error", code);
            throw err;
          }

          // Detect error responses returned as values (isError: true in MCP content)
          const isError = (callResult as { isError?: boolean }).isError === true;

          // Also check for toResult-wrapped error objects (e.g. TIMEOUT_EXCEEDS_DEFAULT)
          let isStructuredError = false;
          try {
            const text = (callResult as { content?: Array<{ text?: string }> }).content?.[0]?.text;
            if (text) {
              const parsed: unknown = JSON.parse(text);
              isStructuredError = typeof parsed === "object" && parsed !== null &&
                ("error" in parsed || "code" in parsed) && !("updates" in parsed) && !("timed_out" in parsed) && !("empty" in parsed);
            }
          } catch { /* ignore parse errors */ }

          recordToolCall(
            name,
            args,
            sid,
            sessionName,
            (isError || isStructuredError) ? "error" : "ok",
          );

          // Inject tutorial hint on first use of each tool
          const response = callResult as {
            content?: Array<{ type: string; text?: string }>;
          } | undefined;
          const hint = getTutorialHint(sid, name, args);
          if (hint) {
            try {
              const firstContent = response?.content?.[0];
              const text = firstContent?.text;
              if (firstContent?.type === "text" && text) {
                const parsed: unknown = JSON.parse(text);
                if (parsed && typeof parsed === "object") {
                  const parsedObj = parsed as Record<string, unknown>;
                  const hasError = "error" in parsedObj;
                  const hasCode = "code" in parsedObj;
                  const hasTutorial = "tutorial" in parsedObj;
                  if (!hasError && !hasCode && !hasTutorial) {
                    parsedObj["tutorial"] = hint;
                    return {
                      ...response,
                      content: [{ type: "text" as const, text: JSON.stringify(parsedObj, null, 2) }],
                    };
                  }
                }
              }
            } catch {
              // Non-JSON response — skip
            }
          }
          return callResult;
        };

        if (sid > 0) {
          return runInTokenHintContext(() =>
            runInSessionContext(sid, run),
          );
        }
        return runInTokenHintContext(run);
      }
    ) as typeof cb;
    return _origRegisterTool(name, config, wrappedCb);
  }) as typeof server.registerTool;

  // ── v6 tools ──────────────────────────────────────────────────────────
  registerHelp(server);
  registerDequeueUpdate(server);
  registerSend(server);
  registerAction(server);

  // ── Resources ────────────────────────────────────────────────────────────
  const agentGuideContent = readFileSync(
    join(__dirname, "..", "docs", "behavior.md"),
    "utf-8"
  );
  const communicationContent = readFileSync(
    join(__dirname, "..", "docs", "communication.md"),
    "utf-8"
  );
  // Strip YAML frontmatter (--- ... ---) before serving as a resource
  const quickReferenceRaw = readFileSync(
    join(__dirname, "..", ".github", "instructions", "telegram-communication.instructions.md"),
    "utf-8"
  );
  const quickReferenceContent = quickReferenceRaw.replace(/^---[\s\S]*?---\n/, "").trimStart();
  const setupContent = readFileSync(
    join(__dirname, "..", "docs", "setup.md"),
    "utf-8"
  );
  const formattingContent = readFileSync(
    join(__dirname, "..", "docs", "formatting.md"),
    "utf-8"
  );

  server.registerResource(
    "agent-guide",
    "telegram-bridge-mcp://agent-guide",
    { mimeType: "text/markdown", description: "Agent behavior guide for this MCP server. Read this at session start to understand how to communicate with the user and which tools to use." },
    () => ({
      contents: [
        {
          uri: "telegram-bridge-mcp://agent-guide",
          mimeType: "text/markdown",
          text: agentGuideContent,
        },
      ],
    })
  );

  server.registerResource(
    "communication-guide",
    "telegram-bridge-mcp://communication-guide",
    { mimeType: "text/markdown", description: "Compact Telegram communication patterns: tool selection, hard rules, commit/push flow, multi-step tasks, and loop behavior." },
    () => ({
      contents: [
        {
          uri: "telegram-bridge-mcp://communication-guide",
          mimeType: "text/markdown",
          text: communicationContent,
        },
      ],
    })
  );

  server.registerResource(
    "quick-reference",
    "telegram-bridge-mcp://quick-reference",
    { mimeType: "text/markdown", description: "Hard rules + tool selection table for Telegram communication. Minimal injected rules card — full detail in communication-guide." },
    () => ({
      contents: [
        {
          uri: "telegram-bridge-mcp://quick-reference",
          mimeType: "text/markdown",
          text: quickReferenceContent,
        },
      ],
    })
  );

  server.registerResource(
    "setup-guide",
    "telegram-bridge-mcp://setup-guide",
    { mimeType: "text/markdown", description: "Step-by-step guide to creating a Telegram bot and running pnpm pair to configure this MCP server." },
    () => ({
      contents: [
        {
          uri: "telegram-bridge-mcp://setup-guide",
          mimeType: "text/markdown",
          text: setupContent,
        },
      ],
    })
  );

  server.registerResource(
    "formatting-guide",
    "telegram-bridge-mcp://formatting-guide",
    { mimeType: "text/markdown", description: "Reference for Markdown/HTML/MarkdownV2 formatting in Telegram messages. Consult this when unsure how to format text." },
    () => ({
      contents: [
        {
          uri: "telegram-bridge-mcp://formatting-guide",
          mimeType: "text/markdown",
          text: formattingContent,
        },
      ],
    })
  );

  return server;
}

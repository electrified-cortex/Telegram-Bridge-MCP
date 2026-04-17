import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runInSessionContext } from "./session-context.js";
import { getActiveSession, getSession } from "./session-manager.js";
import { runInTokenHintContext } from "./tools/identity-schema.js";
import { invokePreToolHook } from "./tool-hooks.js";
import { toError } from "./telegram.js";
import { recordToolCall } from "./trace-log.js";
import {
  initSession,
  setNudgeInjector,
  recordDequeue as btRecordDequeue,
  recordTyping as btRecordTyping,
  recordAnimation as btRecordAnimation,
  recordReaction as btRecordReaction,
  recordSend as btRecordSend,
  recordButtonUse as btRecordButtonUse,
  recordOutboundText as btRecordOutboundText,
} from "./behavior-tracker.js";
import { deliverServiceMessage } from "./session-queue.js";

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

  // ── Behavior tracker wiring ────────────────────────────────────────────
  // Wire the nudge injector to deliver service messages into session queues.
  setNudgeInjector((sid, text, eventType) => {
    deliverServiceMessage(sid, text, eventType);
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

          const outcome = (isError || isStructuredError) ? "error" : "ok";
          recordToolCall(name, args, sid, sessionName, outcome);

          // ── Behavior tracking ──────────────────────────────────────────
          // Record tool calls for per-session behavioral nudges.
          // Only track successful calls on authenticated sessions.
          if (outcome === "ok" && sid > 0) {
            // Ensure the session is initialized in the tracker (idempotent).
            initSession(sid);

            if (name === "show_typing") {
              // Only count non-cancel typing calls as activity indicators.
              const isCancel = args.cancel === true;
              if (!isCancel) btRecordTyping(sid);
            } else if (name === "show_animation" || (name === "send" && args.type === "animation")) {
              // Animation sends count as activity but not toward typing-rate sendCount —
              // they are not text/file deliveries and don't need a preceding show_typing.
              btRecordAnimation(sid);
            } else if (name === "set_reaction") {
              btRecordReaction(sid);
            } else if (name === "send") {
              // Check for button-type sends before counting as plain text send.
              const hasChoose = args.choose !== undefined;
              const hasConfirm = args.confirm !== undefined;
              const hasOptions = args.options !== undefined;
              const isChoiceSend = args.type === "choice";
              const isQuestionWithOptions =
                args.type === "question" && hasOptions;
              const usesButtons =
                hasChoose || hasConfirm || isChoiceSend || isQuestionWithOptions;
              if (usesButtons) {
                btRecordButtonUse(sid);
              } else if (typeof args.text === "string") {
                btRecordOutboundText(sid, args.text);
              }
              // Count any outbound send (text, file, notification, etc.)
              btRecordSend(sid);
            } else if (name === "action" && typeof args.type === "string" && args.type.startsWith("confirm/")) {
              btRecordButtonUse(sid);
            } else if (name === "help" && args.topic === "send") {
              btRecordButtonUse(sid);
            } else if (name === "dequeue") {
              // Detect whether the batch contained user content events.
              // A successful dequeue with `updates` array counts if any
              // event has from: "user".
              try {
                const text = (callResult as { content?: Array<{ text?: string }> }).content?.[0]?.text;
                if (text) {
                  const parsed = JSON.parse(text) as Record<string, unknown>;
                  const updates = parsed.updates;
                  if (Array.isArray(updates)) {
                    const hasUserContent = updates.some(
                      (u: unknown) =>
                        typeof u === "object" && u !== null &&
                        (u as Record<string, unknown>).from === "user",
                    );
                    btRecordDequeue(sid, hasUserContent);
                  }
                }
              } catch { /* ignore parse errors */ }
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
    join(__dirname, "..", "docs", "help", "guide.md"),
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

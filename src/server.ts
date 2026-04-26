import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runInSessionContext } from "./session-context.js";
import { getActiveSession, getSession } from "./session-manager.js";
import { markFirstUseHintSeen } from "./first-use-hints.js";
import { SERVICE_MESSAGES } from "./service-messages.js";
import { runInTokenHintContext } from "./tools/identity-schema.js";
import { invokePreToolHook, FAIL_CLOSED_TOOLS } from "./tool-hooks.js";
import { checkUnknownParams, injectWarningIntoResult } from "./unknown-param-warning.js";
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
  recordPresenceSignal,
} from "./behavior-tracker.js";
import { deliverServiceMessage } from "./session-queue.js";
import { setPresenceNudgeInjector } from "./silence-detector.js";

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

/**
 * Dispatch behavior-tracking record calls for a completed tool call.
 * Exported for unit testing. Called only when outcome === "ok" && sid > 0.
 */
export function dispatchBehaviorTracking(
  sid: number,
  name: string,
  cleanArgs: Record<string, unknown>,
  callResult: unknown,
): void {
  initSession(sid);

  if (name === "show_typing" || (name === "action" && cleanArgs.type === "show-typing")) {
    const isCancel = cleanArgs.cancel === true;
    if (!isCancel) { btRecordTyping(sid); recordPresenceSignal(sid); }
  } else if (name === "show_animation" || (name === "send" && cleanArgs.type === "animation")) {
    btRecordAnimation(sid); recordPresenceSignal(sid);
  } else if (name === "set_reaction" || (name === "action" && cleanArgs.type === "react")) {
    btRecordReaction(sid); recordPresenceSignal(sid);
    // Part B: reaction semantics first-call nudge (task 15-745)
    if (markFirstUseHintSeen(sid, "reaction_semantics")) {
      deliverServiceMessage(sid, SERVICE_MESSAGES.NUDGE_REACTION_SEMANTICS);
    }
  } else if (name === "send") {
    const isDm = cleanArgs.type === "dm";
    if (!isDm) {
      const hasChoose = cleanArgs.choose !== undefined;
      const hasConfirm = cleanArgs.confirm !== undefined;
      const hasOptions = cleanArgs.options !== undefined;
      const isChoiceSend = cleanArgs.type === "choice";
      const isQuestionWithOptions = cleanArgs.type === "question" && hasOptions;
      const usesButtons = hasChoose || hasConfirm || isChoiceSend || isQuestionWithOptions;
      if (usesButtons) {
        btRecordButtonUse(sid);
      } else {
        const outboundText =
          (typeof cleanArgs.text === "string" ? cleanArgs.text : null) ??
          (typeof cleanArgs.message === "string" ? cleanArgs.message : null) ??
          (typeof cleanArgs.ask === "string" ? cleanArgs.ask : null);
        if (outboundText !== null) {
          btRecordOutboundText(sid, outboundText);
        }
      }
      recordPresenceSignal(sid);
      // Trigger B — first outbound send of any type (non-DM): lazy hybrid messaging guidance
      if (markFirstUseHintSeen(sid, "lazy_onboarding_hybrid_messaging")) {
        deliverServiceMessage(sid, SERVICE_MESSAGES.ONBOARDING_HYBRID_MESSAGING);
      }
    }
    btRecordSend(sid);
    // Trigger C — first send(type:"question") with choose/options: lazy buttons guidance
    const isQuestionWithChoose = cleanArgs.type === "question" && (cleanArgs.choose !== undefined || cleanArgs.options !== undefined);
    if (isQuestionWithChoose && markFirstUseHintSeen(sid, "lazy_onboarding_buttons")) {
      deliverServiceMessage(sid, SERVICE_MESSAGES.ONBOARDING_BUTTONS_TEXT);
    }
  } else if (name === "action" && typeof cleanArgs.type === "string" && cleanArgs.type.startsWith("confirm/")) {
    btRecordButtonUse(sid);
    recordPresenceSignal(sid);
    // Trigger C — first confirm/ action: lazy buttons guidance
    if (markFirstUseHintSeen(sid, "lazy_onboarding_buttons")) {
      deliverServiceMessage(sid, SERVICE_MESSAGES.ONBOARDING_BUTTONS_TEXT);
    }
  } else if (name === "help" && cleanArgs.topic === "send") {
    btRecordButtonUse(sid);
  } else if (name === "dequeue") {
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
          // One-time voice modality hint (task 15-714)
          const hasUserVoice = updates.some(
            (u: unknown) =>
              typeof u === "object" && u !== null &&
              (u as Record<string, unknown>).from === "user" &&
              typeof (u as Record<string, unknown>).content === "object" &&
              ((u as Record<string, unknown>).content as Record<string, unknown>).type === "voice",
          );
          if (hasUserVoice && markFirstUseHintSeen(sid, "modality_hint_voice")) {
            deliverServiceMessage(sid, SERVICE_MESSAGES.NUDGE_VOICE_MODALITY);
          }
          // Trigger A — first dequeue returning user content: lazy onboarding guidance
          if (hasUserContent) {
            if (markFirstUseHintSeen(sid, "lazy_onboarding_protocol")) {
              deliverServiceMessage(sid, SERVICE_MESSAGES.ONBOARDING_PROTOCOL);
            }
            if (markFirstUseHintSeen(sid, "lazy_onboarding_modality_priority")) {
              deliverServiceMessage(sid, SERVICE_MESSAGES.ONBOARDING_MODALITY_PRIORITY);
            }
            if (markFirstUseHintSeen(sid, "lazy_onboarding_presence_signals")) {
              deliverServiceMessage(sid, SERVICE_MESSAGES.ONBOARDING_PRESENCE_SIGNALS);
            }
          }
        }
      }
    } catch { /* ignore parse errors */ }
  }
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
  setPresenceNudgeInjector((sid, text, eventType) => {
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
    // Capture the set of known param names once at registration time so the
    // per-call unknown-param check is a cheap Set lookup.
    const knownParams = new Set<string>(Object.keys((config as { inputSchema?: Record<string, unknown> }).inputSchema ?? {}));
    const wrappedCb = (
      (args: Record<string, unknown>, extra: unknown) => {
        // Strip unknown params and capture any warning before anything else runs.
        // This runs before auth so the hook and handler never see hallucinated keys.
        const { clean: cleanArgs, warning: unknownParamWarning } = checkUnknownParams(name, knownParams, args);

        // Decode sid from token (sid * 1_000_000 + suffix) for session context.
        // Falls back to active session for tools that don't require auth.
        // Each call is also wrapped in a token-hint context so the TOKEN_SCHEMA
        // preprocess and the handler share per-request hint state, preventing
        // concurrent requests from corrupting each other's hint flag.
        const token = cleanArgs.token;
        const sid = (typeof token === "number" && token > 0)
          ? Math.floor(token / 1_000_000)
          : getActiveSession();

        const run = async () => {
          // Pre-tool hook fires before the original handler executes.
          // A hook returning allowed:false short-circuits the call and
          // returns a 403-style error.  If the hook itself throws, we
          // fail safe by treating it as blocked.
          const sessionName = (sid > 0 ? getSession(sid)?.name : undefined) ?? "";

          const hookResult = await invokePreToolHook(name, cleanArgs);
          if (!hookResult.allowed) {
            if (hookResult.hookError && !FAIL_CLOSED_TOOLS.has(name)) {
              // Hook error on a fail-open tool — log and allow the call to proceed.
              // Not sent to logBlockedToolCall: the call is not blocked; the error
              // is an infrastructure anomaly, not a policy denial.
              process.stderr.write(
                `[hook:error] ${normalizeLogField(name)} — hook error on fail-open tool; proceeding\n`
              );
            } else {
              const reason = hookResult.reason ?? "Blocked by pre-tool hook";
              logBlockedToolCall(name, reason);
              recordToolCall(name, cleanArgs, sid, sessionName, "blocked", "BLOCKED");
              return toError({ code: "BLOCKED", message: reason });
            }
          }

          let callResult: unknown;
          try {
            callResult = await Promise.resolve(original(cleanArgs, extra));
          } catch (err) {
            const code = err instanceof Error ? err.message : "UNKNOWN_ERROR";
            recordToolCall(name, cleanArgs, sid, sessionName, "error", code);
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
          recordToolCall(name, cleanArgs, sid, sessionName, outcome);

          // ── Behavior tracking ──────────────────────────────────────────
          // Record tool calls for per-session behavioral nudges.
          // Only track successful calls on authenticated sessions.
          if (outcome === "ok" && sid > 0) {
            dispatchBehaviorTracking(sid, name, cleanArgs, callResult);
          }

          // Inject unknown-param warning into the response if any params were stripped.
          if (unknownParamWarning !== undefined) {
            callResult = injectWarningIntoResult(callResult, unknownParamWarning);
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

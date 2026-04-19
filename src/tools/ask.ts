import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, resolveChat, toResult, toError, validateText, ackVoiceMessage } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { applyTopicToText } from "../topic-state.js";
import { dequeueMatch, waitForEnqueue, pendingCount, type TimelineEvent } from "../message-store.js";
import { getSessionQueue, peekSessionCategories } from "../session-queue.js";
import { getCallerSid } from "../session-context.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Send a question and wait for the user to reply. " +
  "Returns { timed_out: true } on expiry; { timed_out: false, aborted: true } on MCP cancel; " +
  "or { timed_out: false, text, message_id } for text, voice, or bot-command replies (voice adds voice: true; commands add command/args). " +
  "Drain pending updates first or pass ignore_pending: true. " +
  "Call `help(topic: 'ask')` for details.";

export async function handleAsk({
  question, timeout_seconds, reply_to, ignore_pending, token,
}: {
  question: string;
  timeout_seconds?: number;
  reply_to?: number;
  ignore_pending?: boolean;
  token: number;
}, signal: AbortSignal) {
  const reply_to_message_id = reply_to;
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);
  const textErr = validateText(question);
  if (textErr) return toError(textErr);

  if (!ignore_pending && !reply_to_message_id) {
    const sid = getCallerSid();
    const sq = sid > 0 ? getSessionQueue(sid) : undefined;
    const pending = sq ? sq.pendingCount() : pendingCount();
    if (pending > 0) {
      const breakdown = sid > 0 ? peekSessionCategories(sid) : undefined;
      const summary = breakdown
        ? Object.entries(breakdown).map(([k, v]) => `${v} ${k}`).join(", ")
        : undefined;
      const detail = summary
        ? `${pending} unread update(s): ${summary}.`
        : `${pending} unread update(s).`;
      return toError({
        code: "PENDING_UPDATES" as const,
        message:
          `${detail} Consider draining with dequeue(timeout:0) before ` +
          `calling ask, or pass ignore_pending: true to proceed anyway.`,
        pending,
        ...(breakdown ? { breakdown } : {}),
      });
    }
  }

  try {
    // Send the question
    const sent = await getApi().sendMessage(chatId, markdownToV2(applyTopicToText(question, "Markdown")), {
      parse_mode: "MarkdownV2",
      reply_parameters: reply_to_message_id ? { message_id: reply_to_message_id } : undefined,
      _rawText: question,
    } as Record<string, unknown>);

    // Poll from the store queue for text or voice messages after our question.
    // Voice messages arrive pre-transcribed by the background poller.
    const pollSid = getCallerSid();
    const sq = pollSid > 0
      ? getSessionQueue(pollSid)
      : undefined;
    const effectiveTimeout = timeout_seconds ?? 86_400;
    const deadline = Date.now() + effectiveTimeout * 1000;
    const abortPromise = new Promise<void>((r) => { if (signal.aborted) r(); else signal.addEventListener("abort", () => { r(); }, { once: true }); });

    while (Date.now() < deadline) {
      if (signal.aborted) return toResult({ timed_out: false, aborted: true });
      const matchFn = (event: TimelineEvent) => {
        if (event.event === "message" && event.id > sent.message_id) {
          if (event.content.type === "text"
            || event.content.type === "command") {
            return event;
          }
          if (event.content.type === "voice" && event.content.text) {
            return event;
          }
        }
        return undefined;
      };
      const match = sq
        ? sq.dequeueMatch(matchFn)
        : dequeueMatch(matchFn);

      if (match) {
        if (match.content.type === "voice") {
          ackVoiceMessage(match.id);
          return toResult({
            timed_out: false,
            text: match.content.text ?? "",
            message_id: match.id,
            voice: true,
          });
        }
        if (match.content.type === "command") {
          return toResult({
            timed_out: false,
            command: match.content.text,
            args: match.content.data,
            message_id: match.id,
          });
        }
        return toResult({
          timed_out: false,
          text: match.content.text,
          message_id: match.id,
        });
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        sq ? sq.waitForEnqueue() : waitForEnqueue(),
        new Promise<void>((r) => { timeoutHandle = setTimeout(r, Math.min(remaining, 5000)); }),
        abortPromise,
      ]);
      clearTimeout(timeoutHandle);
    }

    return toResult({ timed_out: true });
  } catch (err) {
    return toError(err);
  }
}

export function register(server: McpServer) {
  server.registerTool(
    "ask",
    {
      description: DESCRIPTION,
      inputSchema: {
        question: z.string().describe("The question to send"),
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(86400)
        .optional()
        .describe("Seconds to wait for a reply before returning timed_out: true. Omit to use the server maximum (24 h)."),
      reply_to: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Reply to this message ID — shows quoted message above the question"),
      ignore_pending: z
        .boolean()
        .optional()
        .describe("Set true to skip the pending-updates check and block immediately"),
              token: TOKEN_SCHEMA,
},
    },
    async (args, { signal }) => handleAsk(args, signal),
  );
}

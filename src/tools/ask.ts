import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, resolveChat, toResult, toError, validateText, ackVoiceMessage } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { applyTopicToText } from "../topic-state.js";
import { dequeueMatch, waitForEnqueue, type TimelineEvent } from "../message-store.js";

const DESCRIPTION =
  "Sends a question to a chat and waits until the user replies " +
  "with a text message. Returns the reply text directly. " +
  "Use for open-ended prompts where a button isn't appropriate.";

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
        .max(300)
        .default(60)
        .describe("Seconds to wait for a reply before returning timed_out: true"),
      reply_to_message_id: z
        .number()
        .int()
        .optional()
        .describe("Reply to this message ID — shows quoted message above the question"),
      },
    },
    async ({ question, timeout_seconds, reply_to_message_id }, { signal }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);
      const textErr = validateText(question);
      if (textErr) return toError(textErr);

      try {
        // Send the question
        const sent = await getApi().sendMessage(chatId, markdownToV2(applyTopicToText(question, "Markdown")), {
          parse_mode: "MarkdownV2",
          reply_parameters: reply_to_message_id ? { message_id: reply_to_message_id } : undefined,
          _rawText: question,
        } as Record<string, unknown>);

        // Poll from the store queue for text or voice messages after our question.
        // Voice messages arrive pre-transcribed by the background poller.
        const deadline = Date.now() + timeout_seconds * 1000;
        const abortPromise = new Promise<void>((r) => { if (signal.aborted) r(); else signal.addEventListener("abort", () => r(), { once: true }); });

        while (Date.now() < deadline) {
          if (signal.aborted) return toResult({ timed_out: true });
          const match = dequeueMatch((event: TimelineEvent) => {
            if (event.event === "message" && event.id > sent.message_id) {
              if (event.content.type === "text"
                || event.content.type === "command") {
                return event;
              }
              // Don't consume voice until transcription is complete (two-phase recording)
              if (event.content.type === "voice" && event.content.text) {
                return event;
              }
            }
            return undefined;
          });

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
            waitForEnqueue(),
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
  );
}

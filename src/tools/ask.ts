import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, resolveChat, toResult, toError, validateText, pollUntil } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";

/**
 * Sends a question and blocks until the user types a reply.
 * Combines send_message + wait_for_message in a single call with automatic
 * chat_id matching so the agent only gets the reply from the same chat.
 */
export function register(server: McpServer) {
  server.tool(
    "ask",
    "Sends a question to a chat and blocks until the user replies with a text message. Returns the reply text directly. Use for open-ended prompts where a button isn't appropriate.",
    {
      question: z.string().describe("The question to send"),
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(55)
        .default(30)
        .describe("Seconds to wait for a reply before returning timed_out: true"),
    },
    async ({ question, timeout_seconds }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      const chatErr = validateText(question);
      if (chatErr) return toError(chatErr);

      try {
        // Send the question
        await getApi().sendMessage(chatId, markdownToV2(question), { parse_mode: "MarkdownV2" });

        // Poll with 1 s ticks for the reply
        const { match } = await pollUntil(
          (updates) => {
            const msg = updates.find(
              (u) => u.message?.text && String(u.message.chat.id) === chatId
            );
            return msg?.message;
          },
          timeout_seconds,
        );

        if (!match) {
          return toResult({ timed_out: true });
        }

        return toResult({
          timed_out: false,
          text: match.text,
          message_id: match.message_id,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}

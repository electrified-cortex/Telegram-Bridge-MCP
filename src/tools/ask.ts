import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, getOffset, advanceOffset, filterAllowedUpdates, resolveChat, toResult, toError, validateText } from "../telegram.js";

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
        await getApi().sendMessage(chatId, question);

        // Long-poll for the reply from the same chat
        const updates = await getApi().getUpdates({
          offset: getOffset(),
          limit: 100,
          timeout: timeout_seconds,
        });

        advanceOffset(updates);

        const allowed = filterAllowedUpdates(updates);
        const match = allowed.find(
          (u) => u.message?.text && String(u.message.chat.id) === chatId
        );

        if (!match?.message) {
          return toResult({ timed_out: true });
        }

        const msg = match.message;
        return toResult({
          timed_out: false,
          text: msg.text,
          message_id: msg.message_id,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}

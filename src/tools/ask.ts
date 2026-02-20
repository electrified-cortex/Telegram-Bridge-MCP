import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, getOffset, advanceOffset, toResult, toError, validateText } from "../telegram.js";

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
      chat_id: z.string().describe("Target chat ID or @username"),
      question: z.string().describe("The question to send"),
      timeout_seconds: z
        .number()
        .int()
        .min(1)
        .max(55)
        .default(30)
        .describe("Seconds to wait for a reply before returning timed_out: true"),
    },
    async ({ chat_id, question, timeout_seconds }) => {
      const textErr = validateText(question);
      if (textErr) return toError(textErr);

      try {
        // Send the question
        await getApi().sendMessage(chat_id, question);

        // Long-poll for the reply from the same chat
        const updates = await getApi().getUpdates({
          offset: getOffset(),
          limit: 100,
          timeout: timeout_seconds,
        });

        advanceOffset(updates);

        const match = updates.find(
          (u) => u.message?.text && String(u.message.chat.id) === chat_id
        );

        if (!match?.message) {
          return toResult({ timed_out: true });
        }

        const msg = match.message;
        return toResult({
          timed_out: false,
          text: msg.text,
          from: msg.from
            ? { id: msg.from.id, username: msg.from.username, first_name: msg.from.first_name }
            : null,
          message_id: msg.message_id,
          date: msg.date,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";

/**
 * Convenience tool for agent→human confirmation flows.
 *
 * Sends a message with Yes/No inline keyboard buttons and returns the
 * message_id so the agent can pass it directly to wait_for_callback_query.
 *
 * Typical flow:
 *   1. Agent calls send_confirmation  → receives { message_id, chat_id }
 *   2. Agent calls wait_for_callback_query with that message_id
 *   3. Agent reads data ("confirm_yes" / "confirm_no") and acts accordingly
 *   4. Agent calls answer_callback_query to dismiss the loading spinner
 *   5. Agent calls edit_message_text to update the message with the outcome
 */
export function register(server: McpServer) {
  server.tool(
    "send_confirmation",
    "Sends a message with Yes/No inline keyboard buttons. Returns the message_id to pass to wait_for_callback_query. Designed for agent-to-human approval/confirmation workflows.",
    {
      text: z
        .string()
        .describe("The question or request requiring confirmation"),
      yes_text: z
        .string()
        .default("✅ Yes")
        .describe("Label for the affirmative button"),
      no_text: z
        .string()
        .default("❌ No")
        .describe("Label for the negative button"),
      yes_data: z
        .string()
        .default("confirm_yes")
        .describe("Callback data sent when Yes is pressed"),
      no_data: z
        .string()
        .default("confirm_no")
        .describe("Callback data sent when No is pressed"),
    },
    async ({ text, yes_text, no_text, yes_data, no_data }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      try {
        const msg = await getApi().sendMessage(chatId, text, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: yes_text, callback_data: yes_data },
                { text: no_text, callback_data: no_data },
              ],
            ],
          },
        });
        return toResult({
          message_id: msg.message_id,
          hint: "Pass message_id to wait_for_callback_query to block until the user responds.",
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}

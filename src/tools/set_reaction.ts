import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";

/**
 * Allowed emoji reactions from the Telegram Bot API.
 * Non-premium bots can set up to 1 reaction per message.
 */
const ALLOWED_EMOJI = [
  "👍", "👎", "❤", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "🤬", "😢",
  "🎉", "🤩", "🤮", "💩", "🙏", "👌", "🕊", "🤡", "🥱", "🥴", "😍", "🐳",
  "❤‍🔥", "🌚", "🌭", "💯", "🤣", "⚡", "🍌", "🏆", "💔", "🤨", "😐", "🍓",
  "🍾", "💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "👨‍💻", "👀", "🎃", "🙈",
  "😇", "😨", "🤝", "✍", "🤗", "🫡", "🎅", "🎄", "☃", "💅", "🤪", "🗿",
  "🆒", "💘", "🙉", "🦄", "😘", "💊", "🙊", "😎", "👾", "🤷‍♂", "🤷", "🤷‍♀", "😡",
] as const;

export function register(server: McpServer) {
  server.tool(
    "set_reaction",
    "Sets an emoji reaction on a message. Non-premium bots can set up to 1 reaction per message. Pass an empty array to remove all reactions. Use to acknowledge messages — e.g. 👍 for confirmation, 🫡 for task complete, 👀 for noted.",
    {
      message_id: z.number().int().describe("ID of the message to react to"),
      emoji: z
        .string()
        .optional()
        .describe("Emoji to react with. Omit or pass empty array to remove reactions. Allowed: 👍 👎 ❤ 🔥 🥰 👏 😁 🤔 🤯 😱 🎉 🤩 🙏 👌 💯 🤣 ⚡ 🏆 👀 ✍ 🤗 🫡 👾 👻 👨‍💻 😢 and 50+ more"),
      is_big: z
        .boolean()
        .optional()
        .describe("Use big animation (default false)"),
    },
    async ({ message_id, emoji, is_big }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "string") return toError(chatId);
      try {
        const reaction = emoji ? [{ type: "emoji" as const, emoji }] : [];
        await getApi().setMessageReaction(chatId, message_id, reaction as any, { is_big });
        return toResult({ ok: true, message_id, emoji: emoji ?? null });
      } catch (err) {
        return toError(err);
      }
    }
  );
}

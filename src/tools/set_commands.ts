import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../telegram.js";
import { BUILT_IN_COMMANDS } from "../built-in-commands.js";
import { requireAuth } from "../session-gate.js";

const RE_BOT_COMMAND = /^[a-z0-9_]+$/;

const DESCRIPTION =
  'Sets (or clears) the slash-command menu shown in Telegram when the user ' +
  'types "/". Pass an array of {command, description} pairs to register ' +
  'commands — e.g. [{command:"cancel",description:"Stop the current task"}]. ' +
  'Pass an empty array to remove all commands. Commands are scoped to the ' +
  'active chat by default ("chat" scope) so they only appear in this ' +
  'conversation. Use scope "default" to set bot-wide defaults for all ' +
  'private chats.';

export function register(server: McpServer) {
  server.registerTool(
    "set_commands",
    {
      description: DESCRIPTION,
      inputSchema: {
        commands: z
        .array(
          z.object({
            command: z
              .string()
              .min(1)
              .max(32)
              .regex(
                RE_BOT_COMMAND,
                "Command must be lowercase letters, digits, or underscores — no slash prefix"
              )
              .describe('Command name without leading slash, e.g. "cancel"'),
            description: z
              .string()
              .min(1)
              .max(256)
              .describe("Short description shown next to the command in the menu"),
          })
        )
        .describe("Commands to register. Pass [] to clear the command menu."),
      scope: z
        .enum(["chat", "default"])
        .optional()
        .default("chat")
        .describe(
          '"chat" scopes commands to the active chat only (recommended). "default" sets them globally for all private chats.'
        ),
              identity: z
          .tuple([z.number().int(), z.number().int()])
          .optional()
          .describe(
            "Identity tuple [sid, pin] from session_start. " +
            "Required when multiple sessions share the same server process.",
          ),
},
    },
    async ({ commands, scope, identity}) => {
      const _sid = requireAuth(identity);
      if (typeof _sid !== "number") return toError(_sid);
      const chatId = resolveChat();

      // For chat-scoped commands we need the active chat ID
      if (scope === "chat" && typeof chatId !== "number") return toError(chatId);

      try {
        const botCommandScope =
          scope === "chat"
            ? { type: "chat" as const, chat_id: chatId as number }
            : { type: "default" as const };

        // Always prepend built-in commands so they survive agent menu updates.
        // If the agent passes [] to clear, honour it — but keep built-ins.
        const builtIns = [...BUILT_IN_COMMANDS];
        const merged = [
          ...builtIns,
          ...commands.filter(c => !builtIns.some(b => b.command === c.command)),
        ];

        await getApi().setMyCommands(merged, { scope: botCommandScope });

        return toResult({
          ok: true,
          count: merged.length,
          scope,
          commands: merged.length > 0 ? merged : null,
          cleared: commands.length === 0,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}

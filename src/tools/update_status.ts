import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat, validateText } from "../telegram.js";
import { escapeHtml } from "../markdown.js";
import { applyTopicToTitle } from "../topic-state.js";

const STATUS_ICON: Record<string, string> = {
  pending:  "⬜",
  running:  "🔄",
  done:     "✅",
  failed:   "⛔",
  skipped:  "⏭️",
};

function renderStatus(
  title: string,
  steps: { label: string; status: string; detail?: string }[]
): string {
  const lines: string[] = [`<b>${escapeHtml(title)}</b>`, ""];
  for (const step of steps) {
    const icon = STATUS_ICON[step.status] ?? "⬜";
    const detail = step.detail ? ` — <i>${escapeHtml(step.detail)}</i>` : "";
    lines.push(`${icon} ${escapeHtml(step.label)}${detail}`);
  }
  return lines.join("\n");
}

const DESCRIPTION =
  "Creates or updates a live task checklist message in Telegram. First call " +
  "(no message_id) sends the message and returns its ID. Subsequent calls " +
  "edit it in-place with the latest step statuses. Use throughout a " +
  "multi-step agent task to give the user real-time progress.";

export function register(server: McpServer) {
  server.registerTool(
    "update_status",
    {
      description: DESCRIPTION,
      inputSchema: {
        title: z.string().describe("Bold heading for the status block, e.g. \"Refactoring: src/auth.ts\""),
      steps: z
        .array(
          z.object({
            label: z.string().describe("Step description"),
            status: z
              .enum(["pending", "running", "done", "failed", "skipped"])
              .describe("Current status of this step"),
            detail: z.string().optional().describe("Optional short italicized detail, e.g. error message or duration"),
          })
        )
        .min(1)
        .describe("Ordered list of steps with their current statuses"),
      message_id: z
        .number()
        .int()
        .optional()
        .describe("ID of the message to edit. Omit on the first call; pass the returned message_id on subsequent calls."),
      },
    },
    async ({ title, steps, message_id }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);
      try {
        const text = renderStatus(applyTopicToTitle(title), steps);
        const textErr = validateText(text);
        if (textErr) return toError(textErr);

        if (message_id !== undefined) {
          // Editing existing message — proxy handles cancelTyping + animation timeout reset
          const result = await getApi().editMessageText(
            chatId,
            message_id,
            text,
            { parse_mode: "HTML" },
          );
          const edited = typeof result === "boolean" ? { message_id } : result;
          return toResult({ message_id: edited.message_id, updated: true });
        } else {
          // Sending new message — proxy handles animation promote + recording
          const msg = await getApi().sendMessage(chatId, text, {
            parse_mode: "HTML",
            _rawText: title,
          } as Record<string, unknown>);
          return toResult({
            message_id: msg.message_id,
            hint: "Pass this message_id to future update_status calls to edit in-place.",
          });
        }
      } catch (err) {
        return toError(err);
      }
    }
  );
}

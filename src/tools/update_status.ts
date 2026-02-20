import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError } from "../telegram.js";

const STATUS_ICON: Record<string, string> = {
  pending:  "⬜",
  running:  "🔄",
  done:     "✅",
  failed:   "❌",
  skipped:  "⏭️",
};

function renderStatus(
  title: string,
  steps: { label: string; status: string; detail?: string }[]
): string {
  const lines: string[] = [`<b>${title}</b>`, ""];
  for (const step of steps) {
    const icon = STATUS_ICON[step.status] ?? "⬜";
    const detail = step.detail ? ` — <i>${step.detail}</i>` : "";
    lines.push(`${icon} ${step.label}${detail}`);
  }
  return lines.join("\n");
}

/**
 * Renders a live task checklist. On first call (no message_id) creates the
 * message and returns the ID. Subsequent calls pass the message_id back to
 * edit it in-place. The agent keeps a running list of steps and updates their
 * status as work progresses.
 */
export function register(server: McpServer) {
  server.tool(
    "update_status",
    "Creates or updates a live task checklist message in Telegram. First call (no message_id) sends the message and returns its ID. Subsequent calls edit it in-place with the latest step statuses. Use throughout a multi-step agent task to give the user real-time progress.",
    {
      chat_id: z.string().describe("Target chat ID or @username"),
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
    async ({ chat_id, title, steps, message_id }) => {
      try {
        const text = renderStatus(title, steps);

        if (message_id !== undefined) {
          const result = await getApi().editMessageText(
            chat_id,
            message_id,
            text,
            { parse_mode: "HTML" },
          );
          const edited = typeof result === "boolean" ? { message_id } : result;
          return toResult({ message_id: (edited as any).message_id ?? message_id, updated: true });
        } else {
          const msg = await getApi().sendMessage(chat_id, text, {
            parse_mode: "HTML",
          });
          return toResult({
            message_id: msg.message_id,
            chat_id: msg.chat.id,
            hint: "Pass this message_id to future update_status calls to edit in-place.",
          });
        }
      } catch (err) {
        return toError(err);
      }
    }
  );
}

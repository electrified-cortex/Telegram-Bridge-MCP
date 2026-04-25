import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat, validateText } from "../telegram.js";
import { escapeHtml } from "../markdown.js";
import { applyTopicToTitle } from "../topic-state.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

/** Message IDs that have already received a completion reply — prevents duplicates. */
const _completedMessageIds = new Set<number>();

/** @internal reset for unit tests only */
export function resetCompletionTrackingForTest(): void {
  _completedMessageIds.clear();
}

const STEP_STATUS_SCHEMA = z.enum(["pending", "running", "done", "failed", "skipped"]);
type StepStatus = z.infer<typeof STEP_STATUS_SCHEMA>;

const STATUS_ICON: Record<StepStatus, string> = {
  pending:  "⬜",
  running:  "🔄",
  done:     "✅",
  failed:   "⛔",
  skipped:  "⏭️",
};

function renderStatus(
  title: string,
  steps: { label: string; status: StepStatus; detail?: string }[]
): string {
  const lines: string[] = [`<b>${escapeHtml(title)}</b>`, ""];
  for (const step of steps) {
    const icon = STATUS_ICON[step.status];
    const detail = step.detail ? ` — <i>${escapeHtml(step.detail)}</i>` : "";
    lines.push(`${icon} ${escapeHtml(step.label)}${detail}`);
  }
  return lines.join("\n");
}

const STEP_SCHEMA = z.object({
  label: z.string().describe("Step description"),
  status: STEP_STATUS_SCHEMA
    .describe("Current status of this step"),
  detail: z.string().optional().describe("Optional short italicized detail, e.g. error message or duration"),
});

const STEPS_INPUT = z
  .array(STEP_SCHEMA)
  .min(1)
  .describe("Ordered list of steps with their current statuses");

const TITLE_INPUT = z.string().describe("Bold heading for the status block, e.g. \"Refactoring: src/auth.ts\"");

const CREATE_DESCRIPTION =
  "Creates a new live task checklist message in Telegram, auto-pins it (silent). Use for discrete " +
  "named steps with status (pending/running/done/failed). " +
  "For percentage-based progress tracking, use send_new_progress instead. " +
  "Call this once at the start of a multi-step agent task to send the " +
  "checklist and get its message_id. Use the returned message_id with " +
  "update_checklist to edit it in-place as steps progress.";

const UPDATE_DESCRIPTION =
  "Updates an existing live task checklist message in Telegram. Pass the " +
  "message_id previously returned by send_new_checklist to edit it in-place " +
  "with the latest step statuses. Auto-unpins the message when all steps reach " +
  "a terminal status (done/failed/skipped).";

export type ChecklistStep = z.infer<typeof STEP_SCHEMA>;

function completionBadge(steps: ChecklistStep[]): string {
  const failed = steps.filter(s => s.status === "failed").length;
  const skipped = steps.filter(s => s.status === "skipped").length;

  let header: string;
  if (failed > 0) {
    header = "🔴 Failed";
  } else if (skipped > 0) {
    header = "🟡 Incomplete";
  } else {
    header = "✅ Complete";
  }

  const parts: string[] = [];
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (parts.length === 0) return header;
  return `${header}\n${parts.join(", ")}`;
}

export async function handleSendNewChecklist({
  title, steps, token,
}: {
  title: string;
  steps: ChecklistStep[];
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);
  try {
    const text = renderStatus(applyTopicToTitle(title), steps);
    const textErr = validateText(text);
    if (textErr) return toError(textErr);

    // Sending new message — proxy handles animation promote + recording
    const msg = await getApi().sendMessage(chatId, text, {
      parse_mode: "HTML",
      _rawText: title,
    } as Record<string, unknown>);
    await getApi().pinChatMessage(chatId, msg.message_id, { disable_notification: true }).catch(() => {});
    return toResult({ message_id: msg.message_id });
  } catch (err) {
    return toError(err);
  }
}

export async function handleUpdateChecklist({ title, steps, message_id, token }: {
  title: string;
  steps: ChecklistStep[];
  message_id: number;
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);
  try {
    const text = renderStatus(applyTopicToTitle(title), steps);
    const textErr = validateText(text);
    if (textErr) return toError(textErr);

    // Editing existing message — proxy handles cancelTyping + animation timeout reset
    const result = await getApi().editMessageText(
      chatId,
      message_id,
      text,
      { parse_mode: "HTML" },
    );
    const edited = typeof result === "boolean" ? { message_id } : result;
    const TERMINAL: ReadonlySet<StepStatus> = new Set(["done", "failed", "skipped"]);
    const allTerminal = steps.every(s => TERMINAL.has(s.status));
    if (allTerminal) {
      getApi().unpinChatMessage(chatId, message_id).catch(() => {});
      if (!_completedMessageIds.has(message_id)) {
        _completedMessageIds.add(message_id);
        getApi().sendMessage(chatId, completionBadge(steps), {
          reply_to_message_id: message_id,
          _skipHeader: true,
        } as Record<string, unknown>).catch(() => {});
      }
    }
    return toResult({ message_id: edited.message_id });
  } catch (err) {
    return toError(err);
  }
}

export function register(server: McpServer) {
  server.registerTool(
    "send_new_checklist",
    {
      description: CREATE_DESCRIPTION,
      inputSchema: {
        title: TITLE_INPUT,
        steps: STEPS_INPUT,
        token: TOKEN_SCHEMA,
      },
    },
    handleSendNewChecklist,
  );

  server.registerTool(
    "update_checklist",
    {
      description: UPDATE_DESCRIPTION,
      inputSchema: {
        title: TITLE_INPUT,
        steps: STEPS_INPUT,
        message_id: z
          .number()
          .int()
          .min(1)
          .describe("ID of the checklist message to update, as returned by send_new_checklist."),
        token: TOKEN_SCHEMA,
      },
    },
    handleUpdateChecklist,
  );
}

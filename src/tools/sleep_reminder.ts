import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { sleepReminder } from "../reminder-state.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

export function handleSleepReminder({ id, until, token }: { id: string; until: string; token: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  const untilMs = Date.parse(until);
  if (isNaN(untilMs)) {
    return toError({
      code: "INVALID_PARAM" as const,
      message: `Invalid ISO-8601 datetime: "${until}". Provide a valid datetime such as "2026-05-01T00:00:00Z".`,
    });
  }

  const reminder = sleepReminder(id, untilMs);
  if (!reminder) {
    return toError({
      code: "NOT_FOUND" as const,
      message: `No reminder with id="${id}" found for this session. Call action(type: 'reminder/list') to see reminder IDs.`,
    });
  }

  const now = Date.now();
  const sleeping = untilMs > now;
  return toResult({
    sleeping,
    id: reminder.id,
    until: new Date(untilMs).toISOString(),
    ...(sleeping ? {} : { note: "until is in the past — reminder will fire normally on next tick." }),
  });
}

export function register(server: McpServer) {
  server.registerTool(
    "sleep_reminder",
    {
      description:
        "Temporarily suspend a reminder until a given datetime. " +
        "Sleep state is TRANSIENT — it is not persisted across session end or profile/save. " +
        "The reminder resumes firing automatically when now >= until. " +
        "To wake early: call again with a past datetime. " +
        "For indefinite sleep: use a far-future date (e.g. year 9999). " +
        "Does not affect the disabled flag — a disabled reminder stays disabled after sleep expires.",
      inputSchema: {
        id: z.string().describe("Reminder ID to sleep (from action(type: 'reminder/list'))."),
        until: z
          .string()
          .describe("ISO-8601 datetime after which the reminder resumes firing (e.g. \"2026-06-01T09:00:00Z\")."),
        token: TOKEN_SCHEMA,
      },
    },
    handleSleepReminder,
  );
}

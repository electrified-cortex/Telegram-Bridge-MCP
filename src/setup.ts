/**
 * Telegram Bridge MCP — Pairing Setup Script
 *
 * Usage: pnpm pair   (or: node dist/setup.js)
 *
 * 1. Reads BOT_TOKEN from environment / .env
 * 2. Verifies the token with getMe()
 * 3. Generates a random 8-character pairing code
 * 4. Prints the code + a clickable Telegram link to open the bot
 * 5. Long-polls getUpdates until the user sends the exact code
 * 6. Captures the user ID and chat ID from that message
 * 7. Writes / updates .env with all three values
 */

import "dotenv/config";
import { Api } from "grammy";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { randomInt } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "..", ".env");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[randomInt(chars.length)];
  }
  return code;
}

function writeEnv(vars: Record<string, string>): void {
  // Preserve existing .env content, updating or appending keys
  let existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";

  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(existing)) {
      existing = existing.replace(regex, `${key}=${value}`);
    } else {
      existing = existing.trimEnd() + `\n${key}=${value}\n`;
    }
  }

  writeFileSync(ENV_PATH, existing, "utf8");
}

function bold(s: string) { return `\x1b[1m${s}\x1b[0m`; }
function green(s: string) { return `\x1b[32m${s}\x1b[0m`; }
function yellow(s: string) { return `\x1b[33m${s}\x1b[0m`; }
function red(s: string) { return `\x1b[31m${s}\x1b[0m`; }
function dim(s: string) { return `\x1b[2m${s}\x1b[0m`; }

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("");
  console.log(bold("  Telegram Bridge MCP — Pairing Setup"));
  console.log(dim("  ─────────────────────────────────────────────"));
  console.log("");

  // 1. Token
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error(red("  ✗ BOT_TOKEN is not set."));
    console.error("    Create a bot with @BotFather, then either:");
    console.error("      • Add  BOT_TOKEN=<token>  to a .env file in this directory");
    console.error("      • Or set it as an environment variable before running pnpm pair");
    process.exit(1);
  }

  const api = new Api(token);

  // 2. Verify token
  process.stdout.write("  Verifying BOT_TOKEN … ");
  let botInfo;
  try {
    botInfo = await api.getMe();
  } catch {
    console.log(red("failed"));
    console.error(red("\n  ✗ Token rejected by Telegram. Regenerate it with /revoke in @BotFather."));
    process.exit(1);
  }
  console.log(green(`OK  (@${botInfo.username})`));

  // 3. Pairing code
  const code = randomCode();
  const botLink = `https://t.me/${botInfo.username}`;

  console.log("");
  console.log(bold("  Pairing code: ") + bold(green(code)));
  console.log("");
  console.log("  Steps:");
  console.log(`    1. Open your bot in Telegram:  ${bold(botLink)}`);
  console.log(`    2. Send this exact message:    ${bold(code)}`);
  console.log("");
  const TIMEOUT_SECONDS = 30;
  const MAX_WRONG_ATTEMPTS = 3;

  console.log(dim(`  Waiting for you to send the code … (${TIMEOUT_SECONDS} s, ${MAX_WRONG_ATTEMPTS} wrong attempts allowed, Ctrl+C to abort)`));
  console.log("");

  // 4. Poll for the code
  let offset = 0;
  const deadline = Date.now() + TIMEOUT_SECONDS * 1000;
  let wrongAttempts = 0;

  // Drain any stale updates first (short poll, offset-only — nothing shown to user)
  const stale = await api.getUpdates({ timeout: 0, limit: 100 });
  if (stale.length > 0) {
    offset = Math.max(...stale.map((u) => u.update_id)) + 1;
  }

  // Live countdown on same line
  const countdownInterval = setInterval(() => {
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    if (remaining > 0) {
      process.stdout.write(`\r  ${dim(`Expires in ${remaining}s …`)}  `);
    }
  }, 1000);

  while (Date.now() < deadline) {
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    const updates = await api.getUpdates({
      offset,
      limit: 10,
      timeout: Math.min(5, remaining),
    });

    for (const u of updates) {
      if (u.update_id >= offset) offset = u.update_id + 1;

      // Only inspect messages (ignore other update types)
      if (!u.message?.text) continue;

      if (u.message.text.trim() === code) {
        clearInterval(countdownInterval);
        process.stdout.write("\r" + " ".repeat(40) + "\r"); // clear countdown line

        const userId = u.message.from?.id;
        const chatId = u.message.chat.id;

        if (!userId) {
          console.log(yellow("  ↳ Received code but could not determine sender ID. Try again."));
          continue;
        }

        // 5. Success
        console.log(green("  ✓ Code matched!"));
        console.log("");
        console.log(`    User ID  : ${bold(String(userId))}`);
        console.log("");

        // 6. Write to .env
        writeEnv({
          BOT_TOKEN: token,
          ALLOWED_USER_ID: String(userId),
        });

        console.log(green(`  ✓ Written to ${ENV_PATH}`));
        console.log("");
        console.log("  " + bold("Next steps:"));
        console.log("    • Add this server to your MCP host config.");
        console.log("      Credentials are in .env — use them in the \"env\" block.");
        console.log("");

        const distPath = resolve(__dirname, "..", "dist", "index.js").replace(/\\/g, "\\\\");
        const printConfig = (label: string, extra?: string) => {
          console.log(dim(`    — ${label}:`));
          console.log(dim('    "telegram": {'));
          if (extra) console.log(dim(`      ${extra}`));
          console.log(dim(`      "command": "node",`));
          console.log(dim(`      "args": ["${distPath}"],`));
          console.log(dim(`      "env": { "BOT_TOKEN": "<from .env>", "ALLOWED_USER_ID": "${userId}" }`));
          console.log(dim(`    }`));
          console.log("");
        };

        printConfig("VS Code (.vscode/mcp.json or settings.json → mcp.servers)", '"type": "stdio",');
        printConfig("Claude Desktop (claude_desktop_config.json → mcpServers)");
        printConfig("Claude Code (.mcp.json in project root → mcpServers)");

        console.log("    • Or run  " + bold("pnpm start") + "  to start the server manually.");
        console.log("");

        // Send confirmation back to the user
        await api
          .sendMessage(chatId, "✅ *Pairing complete\\!*\n\nThis bot is now secured to your user ID\\.\nYou can now use Telegram Bridge MCP\\.", {
            parse_mode: "MarkdownV2",
          })
          .catch(() => {/* non-fatal */});

        process.exit(0);

      } else {
        // Wrong message sent — count it and abort early if limit reached
        wrongAttempts++;
        process.stdout.write("\r" + " ".repeat(40) + "\r");
        if (wrongAttempts >= MAX_WRONG_ATTEMPTS) {
          clearInterval(countdownInterval);
          console.log(red(`\n  ✗ ${MAX_WRONG_ATTEMPTS} incorrect attempts — pairing aborted for security.`));
          console.log("    Run  pnpm pair  again to get a new code.");
          process.exit(1);
        }
        console.log(yellow(`  ✗ Wrong message (attempt ${wrongAttempts}/${MAX_WRONG_ATTEMPTS}). Expected the pairing code.`));
      }
    }
  }

  clearInterval(countdownInterval);
  process.stdout.write("\r" + " ".repeat(40) + "\r");
  console.log(red("  ✗ Timed out — pairing code expired after 30 seconds."));
  console.log("    Run  pnpm pair  again to get a new code.");
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error(red(`\n  ✗ Unexpected error: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});

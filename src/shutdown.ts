import { getApi, resolveChat } from "./telegram.js";

/**
 * Clears all registered slash-command menus on shutdown.
 * Clears both the active chat scope and the global default scope.
 * Errors are silently swallowed — cleanup is best-effort.
 */
export async function clearCommandsOnShutdown(): Promise<void> {
  const api = getApi();
  const chatId = resolveChat();
  if (typeof chatId === "number") {
    try {
      await api.setMyCommands([], { scope: { type: "chat", chat_id: chatId } });
    } catch { /* ignore — already cleared or bot lacks permission */ }
  }
  try {
    await api.setMyCommands([], { scope: { type: "default" } });
  } catch { /* ignore */ }
}

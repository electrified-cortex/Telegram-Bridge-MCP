/**
 * Action registry — path→handler map for the v6 `action` tool.
 *
 * Handlers are registered with a path (e.g. "session/list") and optional
 * metadata (e.g. { governor: true }). The action tool calls resolveAction()
 * to find and invoke the right handler.
 */

export type ActionHandler = (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;

/**
 * Consolidates the handler-to-ActionHandler cast to one location.
 * Accepts any callable value; the single `as ActionHandler` cast replaces
 * the per-registration `as unknown as ActionHandler` double-cast pattern.
 */
export function toActionHandler(fn: unknown): ActionHandler {
  return fn as ActionHandler;
}

export interface ActionMeta {
  /** When true, the action is restricted to the governor session. */
  governor?: boolean;
}

interface RegistryEntry {
  handler: ActionHandler;
  meta: ActionMeta;
}

const registry = new Map<string, RegistryEntry>();

/**
 * Register an action handler at the given path.
 * Overwrites any existing registration for the same path.
 */
export function registerAction(path: string, handler: ActionHandler, meta: ActionMeta = {}): void {
  registry.set(path, { handler, meta });
}

/**
 * Resolve a registered action by exact path.
 * Returns undefined if no handler is registered for the path.
 */
export function resolveAction(type: string): RegistryEntry | undefined {
  return registry.get(type);
}

/**
 * List all top-level category prefixes (the part before the first "/").
 * Returns an alphabetically sorted, deduplicated list.
 */
export function listCategories(): string[] {
  const cats = new Set([...registry.keys()].map(k => k.split("/")[0]));
  return [...cats].sort();
}

/**
 * List all registered paths whose first segment equals `category`.
 * Returns an alphabetically sorted list.
 */
export function listSubPaths(category: string): string[] {
  return [...registry.keys()]
    .filter(k => k.startsWith(category + "/") || k === category)
    .sort();
}

/**
 * Clear all registered actions. Intended for use in tests only.
 */
export function clearRegistry(): void {
  registry.clear();
}

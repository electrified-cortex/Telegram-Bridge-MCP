import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError } from "./test-utils.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  editMessageText: vi.fn(),
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks, resolveChat: () => "1" };
});

import { register } from "./update_status.js";

const STEPS = [
  { label: "Install deps", status: "done" },
  { label: "Build", status: "running" },
  { label: "Test", status: "pending" },
];

describe("update_status tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("update_status");
  });

  it("creates a new message when no message_id is given", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 10, chat: { id: 1 }, date: 0 });
    const result = await call({ title: "CI Pipeline", steps: STEPS });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.message_id).toBe(10);
    expect(data.hint).toBeDefined();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(mocks.editMessageText).not.toHaveBeenCalled();
  });

  it("edits in-place when message_id is provided", async () => {
    mocks.editMessageText.mockResolvedValue({ message_id: 10 });
    const result = await call({ title: "CI Pipeline", steps: STEPS, message_id: 10 });
    expect(isError(result)).toBe(false);
    expect((parseResult(result) as any).updated).toBe(true);
    expect(mocks.editMessageText).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("renders step statuses with appropriate icons", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0 });
    await call({ title: "T", steps: STEPS });
    const [, text] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("✅");   // done
    expect(text).toContain("🔄");   // running
    expect(text).toContain("⬜");   // pending
  });

  it("includes title in HTML bold", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0 });
    await call({ title: "Pipeline", steps: [{ label: "X", status: "done" }] });
    const [, text] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("<b>Pipeline</b>");
  });

  it("renders optional detail text as italic", async () => {
    mocks.sendMessage.mockResolvedValue({ message_id: 1, chat: { id: 1 }, date: 0 });
    await call({
      title: "T",
      steps: [{ label: "Build", status: "failed", detail: "exit code 1" }],
    });
    const [, text] = mocks.sendMessage.mock.calls[0];
    expect(text).toContain("<i>exit code 1</i>");
  });
});

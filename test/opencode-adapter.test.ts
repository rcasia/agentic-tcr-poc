import { describe, expect, it, vi } from "vitest";
import { OpenCodeAdapter, type OpenCodeClient } from "../src/opencode-adapter";

describe("OpenCodeAdapter", () => {
  it("observes the session diff without deciding acceptance", async () => {
    const client: OpenCodeClient = {
      session: {
        diff: vi.fn().mockResolvedValue([{ file: "src/index.ts" }]),
        abort: vi.fn(),
        revert: vi.fn(),
        prompt: vi.fn(),
      },
    };

    const adapter = new OpenCodeAdapter(client, "ses_test");
    const mutation = await adapter.observeMutation("msg_1");

    expect(mutation.id).toBe("msg_1");
    expect(client.session.diff).toHaveBeenCalledWith({
      path: { id: "ses_test" },
      query: { messageID: "msg_1" },
    });
  });

  it("maps interrupt to OpenCode abort", async () => {
    const client: OpenCodeClient = {
      session: {
        diff: vi.fn(),
        abort: vi.fn().mockResolvedValue(true),
        revert: vi.fn(),
        prompt: vi.fn(),
      },
    };

    const adapter = new OpenCodeAdapter(client, "ses_test");
    await adapter.interrupt();

    expect(client.session.abort).toHaveBeenCalledWith({ path: { id: "ses_test" } });
  });

  it("maps rejection to OpenCode revert and feedback to the same session", async () => {
    const client: OpenCodeClient = {
      session: {
        diff: vi.fn(),
        abort: vi.fn(),
        revert: vi.fn().mockResolvedValue(true),
        prompt: vi.fn().mockResolvedValue(undefined),
      },
    };

    const adapter = new OpenCodeAdapter(client, "ses_test");
    await adapter.rejectOrRestore("msg_1", "part_1");
    await adapter.sendFeedback("Fix the failing test");

    expect(client.session.revert).toHaveBeenCalledWith({
      path: { id: "ses_test" },
      body: { messageID: "msg_1", partID: "part_1" },
    });
    expect(client.session.prompt).toHaveBeenCalledWith({
      path: { id: "ses_test" },
      body: { text: "Fix the failing test" },
    });
  });
});

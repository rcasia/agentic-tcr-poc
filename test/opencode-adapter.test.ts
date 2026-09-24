import test from "node:test";
import assert from "node:assert/strict";

import { OpenCodeAdapter, type OpenCodeClient } from "../src/opencode-adapter.js";

function makeCalls() {
  const calls: { name: string; arg: unknown }[] = [];
  const client: OpenCodeClient = {
    session: {
      diff: async (input: { path: { id: string }; query?: { messageID?: string } }) => {
        calls.push({ name: "diff", arg: input });
        return [{ file: "src/index.ts" }];
      },
      abort: async (input: { path: { id: string } }) => {
        calls.push({ name: "abort", arg: input });
        return true;
      },
      revert: async (input: {
        path: { id: string };
        body: { messageID: string; partID?: string };
      }) => {
        calls.push({ name: "revert", arg: input });
        return true;
      },
      prompt: async (input: { path: { id: string }; body: { text: string } }) => {
        calls.push({ name: "prompt", arg: input });
        return undefined;
      },
    },
  };
  return { client, calls };
}

test("observes the session diff without deciding acceptance", async () => {
  const { client, calls } = makeCalls();

  const adapter = new OpenCodeAdapter(client, "ses_test");
  const mutation = await adapter.observeMutation("msg_1");

  assert.equal(mutation.id, "msg_1");
  assert.deepEqual(calls[0], {
    name: "diff",
    arg: { path: { id: "ses_test" }, query: { messageID: "msg_1" } },
  });
});

test("maps interrupt to OpenCode abort", async () => {
  const { client, calls } = makeCalls();

  const adapter = new OpenCodeAdapter(client, "ses_test");
  await adapter.interrupt();

  assert.deepEqual(calls[0], { name: "abort", arg: { path: { id: "ses_test" } } });
});

test("maps rejection to OpenCode revert and feedback to the same session", async () => {
  const { client, calls } = makeCalls();

  const adapter = new OpenCodeAdapter(client, "ses_test");
  await adapter.rejectOrRestore("msg_1", "part_1");
  await adapter.sendFeedback("Fix the failing test");

  assert.deepEqual(calls[0], {
    name: "revert",
    arg: { path: { id: "ses_test" }, body: { messageID: "msg_1", partID: "part_1" } },
  });
  assert.deepEqual(calls[1], {
    name: "prompt",
    arg: { path: { id: "ses_test" }, body: { text: "Fix the failing test" } },
  });
});

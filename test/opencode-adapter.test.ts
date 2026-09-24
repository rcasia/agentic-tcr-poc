import test from "node:test";
import assert from "node:assert/strict";

import {
  OpenCodeAdapter,
  type OpenCodeClient,
} from "../src/opencode-adapter.js";

function makeCalls() {
  const calls: { name: string; arg: unknown }[] = [];
  const client: OpenCodeClient = {
    session: {
      diff: async (input: { path: { id: string }; query?: { messageID?: string } }) => {
        calls.push({ name: "diff", arg: input });
        return [{ file: "src/index.ts", additions: 2, deletions: 1 }];
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

test("captures a generic mutation and retains the restore handle in the adapter", async () => {
  const { client, calls } = makeCalls();
  const context = { executionId: "exec-1", workspaceId: "ws-1", sequence: 1 };
  const adapter = new OpenCodeAdapter(client, "ses_test", () => ({
    messageID: "msg_1",
    partID: "part_1",
  }));

  const mutation = await adapter.observeMutation(context);

  assert.equal(mutation.execution, context);
  assert.deepEqual(mutation.changes, [
    { path: "src/index.ts", additions: 2, deletions: 1 },
  ]);
  assert.deepEqual(calls[0], {
    name: "diff",
    arg: { path: { id: "ses_test" }, query: { messageID: "msg_1" } },
  });
  assert.ok(!("messageID" in mutation));
  assert.ok(!("partID" in mutation));
});

test("maps interrupt to OpenCode abort for the configured session", async () => {
  const { client, calls } = makeCalls();
  const context = { executionId: "exec-2", sequence: 2 };
  const adapter = new OpenCodeAdapter(client, "ses_test", () => ({
    messageID: "msg_2",
  }));

  await adapter.interrupt(context);

  assert.deepEqual(calls[0], {
    name: "abort",
    arg: { path: { id: "ses_test" } },
  });
});

test("restores the captured mutation and sends feedback to the same session", async () => {
  const { client, calls } = makeCalls();
  const context = { executionId: "exec-3", sequence: 3 };
  const adapter = new OpenCodeAdapter(client, "ses_test", () => ({
    messageID: "msg_3",
    partID: "part_3",
  }));
  const mutation = await adapter.observeMutation(context);

  await adapter.rejectOrRestore(context, mutation);
  await adapter.sendFeedback(context, "Fix the failing test");

  assert.deepEqual(calls[1], {
    name: "revert",
    arg: {
      path: { id: "ses_test" },
      body: { messageID: "msg_3", partID: "part_3" },
    },
  });
  assert.deepEqual(calls[2], {
    name: "prompt",
    arg: {
      path: { id: "ses_test" },
      body: { text: "Fix the failing test" },
    },
  });
  assert.deepEqual(
    calls.map(({ arg }) => arg).map((arg) => (arg as { path: { id: string } }).path.id),
    ["ses_test", "ses_test", "ses_test"],
  );
});

test("does not restore an unknown mutation", async () => {
  const { client } = makeCalls();
  const context = { executionId: "exec-4", sequence: 4 };
  const adapter = new OpenCodeAdapter(client, "ses_test", () => ({
    messageID: "msg_4",
  }));

  await assert.rejects(
    adapter.rejectOrRestore(context, { id: "unknown", execution: context }),
    /No OpenCode restore handle for mutation unknown/,
  );
});

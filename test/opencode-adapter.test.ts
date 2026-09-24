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
      diff: async (input) => {
        calls.push({ name: "diff", arg: input });
        return [{
          file: "src/index.ts",
          patch: "@@ -1 +1 @@",
          additions: 2,
          deletions: 1,
          status: "modified",
        }];
      },
      interrupt: async (input) => {
        calls.push({ name: "interrupt", arg: input });
        return { interrupted: true };
      },
      prompt: async (input) => {
        calls.push({ name: "prompt", arg: input });
        return {
          id: "inbox-1",
          sessionID: input.sessionID,
          time: { created: 1 },
          type: "user",
          payload: { text: input.text },
          delivery: input.delivery ?? "steer",
        };
      },
      revert: {
        stage: async (input) => {
          calls.push({ name: "revert.stage", arg: input });
          return {} as never;
        },
        commit: async (input) => {
          calls.push({ name: "revert.commit", arg: input });
        },
      },
    },
  };
  return { client, calls };
}

test("captures a generic mutation with official OpenCode diff data", async () => {
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
    arg: { sessionID: "ses_test", from: "msg_1" },
  });
  assert.ok(!("messageID" in mutation));
  assert.ok(!("partID" in mutation));
});

test("maps interrupt to OpenCode interrupt for the configured session", async () => {
  const { client, calls } = makeCalls();
  const context = { executionId: "exec-2", sequence: 2 };
  const adapter = new OpenCodeAdapter(client, "ses_test", () => ({
    messageID: "msg_2",
  }));

  await adapter.interrupt(context);

  assert.deepEqual(calls[0], {
    name: "interrupt",
    arg: { sessionID: "ses_test" },
  });
});

test("restores the captured mutation and steers feedback without an assistant turn", async () => {
  const { client, calls } = makeCalls();
  const context = { executionId: "exec-3", sequence: 3 };
  const adapter = new OpenCodeAdapter(client, "ses_test", () => ({
    messageID: "msg_3",
    partID: "part_3",
  }));
  const mutation = await adapter.observeMutation(context);

  await adapter.rejectOrRestore(context, mutation);
  const continuation = await adapter.sendFeedback(context, "Fix the failing test");

  assert.deepEqual(calls[1], {
    name: "revert.stage",
    arg: { sessionID: "ses_test", messageID: "msg_3", files: true },
  });
  assert.deepEqual(calls[2], {
    name: "revert.commit",
    arg: { sessionID: "ses_test" },
  });
  assert.deepEqual(calls[3], {
    name: "prompt",
    arg: { sessionID: "ses_test", text: "Fix the failing test", delivery: "steer" },
  });
  assert.deepEqual(
    calls.map(({ arg }) => (arg as { sessionID: string }).sessionID),
    ["ses_test", "ses_test", "ses_test", "ses_test"],
  );
  assert.equal(continuation.context, context);
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

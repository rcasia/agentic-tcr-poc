import test from "node:test";
import assert from "node:assert/strict";

import {
  OpenCodeAdapter,
  type OpenCodeClient,
} from "../src/opencode-adapter.js";
import { runWorkflow } from "../src/workflow.js";

function fakeOpenCodeRuntime(events: string[]): OpenCodeClient {
  return {
    session: {
      diff: async ({ path, query }) => {
        events.push(`diff:${path.id}:${query?.messageID ?? "none"}`);
        return [{ file: "src/changed.ts", additions: 1, deletions: 0 }];
      },
      abort: async ({ path }) => {
        events.push(`abort:${path.id}`);
        return true;
      },
      revert: async ({ path, body }) => {
        events.push(`revert:${path.id}:${body.messageID}:${body.partID ?? "none"}`);
        return true;
      },
      prompt: async ({ path, body }) => {
        events.push(`prompt:${path.id}:${body.text}`);
        return undefined;
      },
    },
  };
}

test("integration PASS captures, verifies, accepts, and continues the same execution", async () => {
  const events: string[] = [];
  const context = { executionId: "exec-pass", workspaceId: "ws-1", sequence: 1 };
  const adapter = new OpenCodeAdapter(
    fakeOpenCodeRuntime(events),
    "ses-shared",
    ({ sequence }) => ({ messageID: `msg-${sequence}` }),
  );

  const result = await runWorkflow(context, adapter, async (mutation) => {
    events.push(`verify:${mutation.execution?.executionId}`);
    return { status: "PASS" };
  });

  assert.deepEqual(events, [
    "diff:ses-shared:msg-1",
    "verify:exec-pass",
  ]);
  assert.equal(result.context, context);
  assert.equal(result.decision.type, "ACCEPT");
});

test("integration FAIL interrupts, restores, feeds back, and continues the same execution", async () => {
  const events: string[] = [];
  const context = { executionId: "exec-fail", workspaceId: "ws-1", sequence: 2 };
  const adapter = new OpenCodeAdapter(
    fakeOpenCodeRuntime(events),
    "ses-shared",
    ({ sequence }) => ({ messageID: `msg-${sequence}`, partID: `part-${sequence}` }),
  );

  const result = await runWorkflow(context, adapter, async (mutation) => {
    events.push(`verify:${mutation.execution?.executionId}`);
    return { status: "FAIL", feedback: "tests failed" };
  });

  assert.deepEqual(events, [
    "diff:ses-shared:msg-2",
    "verify:exec-fail",
    "abort:ses-shared",
    "revert:ses-shared:msg-2:part-2",
    "prompt:ses-shared:tests failed",
  ]);
  assert.equal(result.context, context);
  assert.equal(result.decision.type, "REJECT");
  assert.notEqual(result.decision.type, "ACCEPT");
});

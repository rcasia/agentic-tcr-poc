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
      diff: async ({ sessionID, from }) => {
        events.push(`diff:${sessionID}:${from ?? "none"}`);
        return [{
          file: "src/changed.ts",
          patch: "@@ -1 +1 @@",
          additions: 1,
          deletions: 0,
          status: "modified",
        }];
      },
      interrupt: async ({ sessionID }) => {
        events.push(`interrupt:${sessionID}`);
        return { interrupted: true };
      },
      revert: {
        stage: async ({ sessionID, messageID }) => {
          events.push(`revert.stage:${sessionID}:${messageID}`);
          return {} as never;
        },
        commit: async ({ sessionID }) => {
          events.push(`revert.commit:${sessionID}`);
        },
      },
      prompt: async ({ sessionID, text, delivery }) => {
        events.push(`prompt:${sessionID}:${text}:${delivery ?? "none"}`);
        return {
          id: "inbox-1",
          sessionID,
          time: { created: 1 },
          type: "user",
          payload: { text },
          delivery: delivery ?? "steer",
        };
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
    "interrupt:ses-shared",
    "revert.stage:ses-shared:msg-2",
    "revert.commit:ses-shared",
    "prompt:ses-shared:tests failed:steer",
  ]);
  assert.equal(result.context, context);
  assert.equal(result.decision.type, "REJECT");
  assert.notEqual(result.decision.type, "ACCEPT");
});

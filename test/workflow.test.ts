import test from "node:test";
import assert from "node:assert/strict";

import type { Mutation } from "../src/mutation.js";
import {
  runWorkflow,
  type RuntimeAdapter,
} from "../src/workflow.js";

function adapterFor(
  events: string[],
  captured: Mutation,
): RuntimeAdapter {
  return {
    async observeMutation(context) {
      events.push(`observe:${context.executionId}`);
      return captured;
    },
    async interrupt(context) {
      events.push(`interrupt:${context.executionId}`);
    },
    async rejectOrRestore(context, mutation) {
      events.push(`restore:${context.executionId}:${mutation.id}`);
    },
    async sendFeedback(context, feedback) {
      events.push(`feedback:${context.executionId}:${feedback ?? ""}`);
      return { context };
    },
  };
}

test("FAIL interrupts before restore and feedback in the same execution", async () => {
  const events: string[] = [];
  const context = { executionId: "exec-1", workspaceId: "ws-1", sequence: 1 };
  const mutation = { id: "mutation-1", execution: context };
  const adapter = adapterFor(events, mutation);

  const result = await runWorkflow(context, adapter, async (captured) => {
    events.push(`verify:${captured.execution?.executionId}`);
    return { status: "FAIL", feedback: "tests failed" };
  });

  assert.deepEqual(events, [
    "observe:exec-1",
    "verify:exec-1",
    "interrupt:exec-1",
    "restore:exec-1:mutation-1",
    "feedback:exec-1:tests failed",
  ]);
  assert.equal(result.context, context);
  assert.equal(result.decision.type, "REJECT");
  assert.equal(result.decision.mutation, mutation);
});

test("PASS accepts without interruption or restoration", async () => {
  const events: string[] = [];
  const context = { executionId: "exec-2", sequence: 2 };
  const mutation = { id: "mutation-2", execution: context };
  const adapter = adapterFor(events, mutation);

  const result = await runWorkflow(context, adapter, async () => {
    events.push("verify");
    return { status: "PASS" };
  });

  assert.deepEqual(events, ["observe:exec-2", "verify"]);
  assert.equal(result.context, context);
  assert.equal(result.decision.type, "ACCEPT");
  assert.equal(result.decision.mutation, mutation);
});

test("workflow associates an uncoupled capture with the supplied execution", async () => {
  const context = { executionId: "exec-3", sequence: 3 };
  const captured = { id: "mutation-3" };
  const events: string[] = [];
  const adapter = adapterFor(events, captured);

  const result = await runWorkflow(context, adapter, async (mutation) => {
    assert.deepEqual(mutation.execution, context);
    return { status: "PASS" };
  });

  assert.equal(result.decision.mutation.execution, context);
});

test("workflow rejects a continuation that changes execution identity", async () => {
  const context = { executionId: "exec-original", sequence: 4 };
  const adapter: RuntimeAdapter = {
    async observeMutation() {
      return { id: "mutation-4", execution: context };
    },
    async interrupt() {},
    async rejectOrRestore() {},
    async sendFeedback() {
      return { context: { executionId: "exec-new", sequence: 4 } };
    },
  };

  await assert.rejects(
    runWorkflow(context, adapter, async () => ({
      status: "FAIL",
      feedback: "failure",
    })),
    /Runtime continuation changed the execution context/,
  );
});

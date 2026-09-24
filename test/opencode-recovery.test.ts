import test from "node:test";
import assert from "node:assert/strict";

import { createOpenCodeTcrPluginState } from "../src/opencode-plugin.js";
import type { RuntimeAdapter } from "../src/workflow.js";

function adapterFor(events: string[]): RuntimeAdapter {
  return {
    async observeMutation(context) {
      events.push(`capture:${context.sequence}`);
      return {
        id: `mutation-${context.sequence}`,
        execution: context,
        changes: [{ path: "src/changed.ts", additions: 1, deletions: 0 }],
      };
    },
    async interrupt(context) {
      events.push(`interrupt:${context.sequence}`);
    },
    async rejectOrRestore(context, mutation) {
      events.push(`restore:${context.sequence}:${mutation.id}`);
    },
    async sendFeedback(context, feedback) {
      events.push(`feedback:${context.sequence}:${feedback ?? ""}`);
      return { context };
    },
  };
}

test("plugin recovery runs FAIL ordering and continues with the next mutation", async () => {
  const events: string[] = [];
  let verificationCount = 0;
  const state = createOpenCodeTcrPluginState(process.cwd(), {
    verifier: async (mutation) => {
      verificationCount += 1;
      events.push(`verify:${mutation.id}`);
      return verificationCount === 1
        ? { status: "FAIL", feedback: "fix the failing check" }
        : { status: "PASS" };
    },
  });
  state.initializeSession("ses-recovery");
  const adapter = adapterFor(events);

  state.handleEvent({
    type: "file.edited",
    properties: { sessionID: "ses-recovery", file: "src/changed.ts" },
  });
  const failed = await state.supervisePendingMutation("ses-recovery", adapter);

  assert.equal(failed?.decision.type, "REJECT");
  assert.deepEqual(events, [
    "capture:1",
    "verify:mutation-1",
    "interrupt:1",
    "restore:1:mutation-1",
    "feedback:1:fix the failing check",
  ]);
  assert.equal(state.getSession("ses-recovery")?.context.sequence, 2);

  state.handleEvent({
    type: "file.edited",
    properties: { sessionID: "ses-recovery", file: "src/fixed.ts" },
  });
  const passed = await state.supervisePendingMutation("ses-recovery", adapter);

  assert.equal(passed?.decision.type, "ACCEPT");
  assert.deepEqual(events, [
    "capture:1",
    "verify:mutation-1",
    "interrupt:1",
    "restore:1:mutation-1",
    "feedback:1:fix the failing check",
    "capture:2",
    "verify:mutation-2",
  ]);
  assert.equal(state.getSession("ses-recovery")?.context.sequence, 3);
});

test("plugin does not supervise an idle session without a pending edit", async () => {
  const state = createOpenCodeTcrPluginState(process.cwd(), {
    verifier: async () => ({ status: "PASS" }),
  });
  state.initializeSession("ses-idle");

  const result = await state.supervisePendingMutation("ses-idle", adapterFor([]));

  assert.equal(result, undefined);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  OpenCodeMutationCapture,
  type OpenCodeFileEditedEvent,
} from "../src/opencode-mutation-capture.js";

function edited(sessionID: string, file: string): OpenCodeFileEditedEvent {
  return { type: "file.edited", properties: { sessionID, file } };
}

test("coalesces file edits and captures one adapter diff at idle", async () => {
  const capture = new OpenCodeMutationCapture();
  const context = { executionId: "opencode:ses-1", scopeId: "/workspace", sequence: 1 };
  const observedContexts: string[] = [];

  capture.recordFileEdited(edited("ses-1", "src/a.ts"));
  capture.recordFileEdited(edited("ses-1", "src/a.ts"));
  capture.recordFileEdited(edited("ses-1", "src/b.ts"));

  const mutation = await capture.captureOnIdle("ses-1", context, async (observed) => {
    observedContexts.push(observed.executionId);
    return {
      id: "mutation-1",
      execution: observed,
      changes: [
        { path: "src/a.ts", additions: 1, deletions: 0 },
        { path: "src/b.ts", additions: 2, deletions: 0 },
      ],
    };
  });

  assert.equal(mutation?.id, "mutation-1");
  assert.deepEqual(observedContexts, ["opencode:ses-1"]);
  assert.equal(capture.hasPendingMutation("ses-1"), false);
});

test("empty session diffs are ignored and do not create mutations", async () => {
  const capture = new OpenCodeMutationCapture();
  capture.recordFileEdited(edited("ses-empty", "src/noop.ts"));

  const mutation = await capture.captureOnIdle(
    "ses-empty",
    { executionId: "opencode:ses-empty", sequence: 1 },
    async (context) => ({ id: "empty", execution: context, changes: [] }),
  );

  assert.equal(mutation, undefined);
  assert.equal(capture.hasPendingMutation("ses-empty"), false);
});

test("captures sequential mutation boundaries independently", async () => {
  const capture = new OpenCodeMutationCapture();
  const contexts: number[] = [];
  const observe = async (context: { executionId: string; sequence: number }) => {
    contexts.push(context.sequence);
    return { id: `mutation-${context.sequence}`, execution: context, changes: [{ path: "src/a.ts" }] };
  };

  capture.recordFileEdited(edited("ses-sequence", "src/a.ts"));
  await capture.captureOnIdle("ses-sequence", { executionId: "opencode:ses-sequence", sequence: 1 }, observe);
  capture.recordFileEdited(edited("ses-sequence", "src/b.ts"));
  const second = await capture.captureOnIdle(
    "ses-sequence",
    { executionId: "opencode:ses-sequence", sequence: 2 },
    observe,
  );

  assert.deepEqual(contexts, [1, 2]);
  assert.equal(second?.id, "mutation-2");
});

import test from "node:test";
import assert from "node:assert/strict";

import AgenticTcrPlugin from "../.opencode/plugins/agentic-tcr.js";
import { createOpenCodeTcrPluginState } from "../src/opencode-plugin.js";

test("plugin state initializes one configured TCR execution per session", () => {
  const state = createOpenCodeTcrPluginState(process.cwd());
  const session = state.initializeSession("ses_plugin");

  assert.equal(state.configuration.status, "FOUND");
  assert.equal(session.context.executionId, "opencode:ses_plugin");
  assert.equal(session.context.workspaceId, process.cwd());
  assert.equal(session.context.scopeId, process.cwd());
  assert.equal(session.context.sequence, 1);
  assert.equal(state.initializeSession("ses_plugin"), session);
  assert.equal(state.nextMutationContext("ses_plugin").sequence, 2);
  assert.equal(state.getSession("ses_plugin")?.context.sequence, 2);
  state.dispose();
  assert.equal(state.sessions.size, 0);
});

test("session lifecycle keeps idle sessions and cleans up errors/deletions", () => {
  const state = createOpenCodeTcrPluginState(process.cwd());

  state.handleEvent({
    type: "session.created",
    properties: { info: { id: "ses-one", directory: process.cwd() } },
  });
  state.handleEvent({
    type: "file.edited",
    properties: { sessionID: "ses-one", file: "src/example.ts" },
  });
  assert.equal(state.mutationCapture.hasPendingMutation("ses-one"), true);
  state.handleEvent({
    type: "session.idle",
    properties: { info: { id: "ses-one" } },
  });
  state.handleEvent({
    type: "session.created",
    properties: { info: { id: "ses-two", directory: process.cwd() } },
  });

  assert.equal(state.sessions.size, 2);
  assert.notEqual(
    state.getSession("ses-one")?.context.executionId,
    state.getSession("ses-two")?.context.executionId,
  );

  state.handleEvent({
    type: "session.error",
    properties: { sessionID: "ses-one" },
  });
  assert.equal(state.getSession("ses-one"), undefined);
  assert.notEqual(state.getSession("ses-two"), undefined);

  state.handleEvent({
    type: "session.deleted",
    properties: { sessionID: "ses-two" },
  });
  assert.equal(state.sessions.size, 0);
});

test("session lifecycle ignores sessions outside the project worktree", () => {
  const state = createOpenCodeTcrPluginState(process.cwd());

  state.handleEvent({
    type: "session.created",
    properties: { info: { id: "ses-other", directory: "/tmp/another-project" } },
  });

  assert.equal(state.sessions.size, 0);
});

test("local plugin initializes, handles session lifecycle, and disposes", async () => {
  const plugin = await AgenticTcrPlugin({
    directory: process.cwd(),
    worktree: process.cwd(),
  });

  await plugin.event({
    event: {
      type: "session.created",
      properties: { info: { id: "ses_created" } },
    },
  });
  await plugin.event({
    event: {
      type: "session.deleted",
      properties: { info: { id: "ses_created" } },
    },
  });
  await plugin.dispose();
});

test("plugin verifies a captured mutation with the project verifier", async () => {
  const state = createOpenCodeTcrPluginState(process.cwd(), {
    verifier: async () => ({ status: "PASS" }),
  });
  state.initializeSession("ses-verify");
  state.handleEvent({
    type: "file.edited",
    properties: { sessionID: "ses-verify", file: "src/example.ts" },
  });

  const seen: string[] = [];
  const result = await state.captureAndVerify("ses-verify", async (context) => {
    seen.push(context.executionId);
    return {
      id: "mutation-plugin-verify",
      execution: context,
      changes: [{ path: "src/example.ts", additions: 1, deletions: 0 }],
    };
  });

  assert.deepEqual(seen, ["opencode:ses-verify"]);
  assert.equal(result?.mutation.id, "mutation-plugin-verify");
  assert.equal(result?.verification.status, "PASS");
});

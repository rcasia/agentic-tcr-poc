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
  state.dispose();
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

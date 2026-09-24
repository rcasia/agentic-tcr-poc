import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import FixturePlugin from "./fixtures/opencode-project/.opencode/plugins/agentic-tcr.js";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures/opencode-project");

test("fixture project contains project verification and local plugin setup", async () => {
  const configuration = JSON.parse(
    readFileSync(join(fixtureRoot, "agentic-tcr.config.json"), "utf8"),
  ) as { verification: { checks: Array<{ name: string }> } };

  assert.equal(existsSync(join(fixtureRoot, ".opencode/plugins/agentic-tcr.ts")), true);
  assert.equal(configuration.verification.checks[0].name, "fixture-check");

  const plugin = await FixturePlugin({
    directory: fixtureRoot,
    worktree: fixtureRoot,
  });
  await plugin.event({
    event: {
      type: "session.created",
      properties: { info: { id: "fixture-session", directory: fixtureRoot } },
    },
  });
  await plugin.dispose();
});

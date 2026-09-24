import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createDemoAdapter, main, runDemo } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(here, "../src/index.ts"), "utf8");

test("POC starts with a TypeScript test harness", () => {
  assert.equal(typeof main, "function");
});

test("demo runs one mutation through the workflow and accepts on PASS", async () => {
  const result = await runDemo({
    verify: async (mutation) => {
      assert.ok(mutation.id.startsWith("mutation:poc-execution:"));
      return { status: "PASS" };
    },
  });

  assert.equal(result.decision.type, "ACCEPT");
  assert.equal(result.context.executionId, "poc-execution");
});

test("demo rejects and keeps the same execution on FAIL", async () => {
  const context = { executionId: "exec-demo", sequence: 1 };
  const result = await runDemo({
    context,
    verify: async () => ({ status: "FAIL", feedback: "demo failure" }),
  });

  assert.equal(result.decision.type, "REJECT");
  assert.equal(result.context, context);
  if (result.decision.type === "REJECT") {
    assert.equal(result.decision.feedback, "demo failure");
  }
});

test("demo adapter observes the captured mutation for the execution", async () => {
  const context = { executionId: "exec-observe", sequence: 3 };
  const adapter = createDemoAdapter({ id: "mutation-demo" });

  const observed = await adapter.observeMutation(context);

  assert.equal(observed.id, "mutation-demo");
  assert.deepEqual(observed.execution, context);
});

test("generic entrypoint carries no runtime-specific dependencies", () => {
  for (const token of ["OpenCodeClient", "sessionId", "messageID", "partID"]) {
    assert.ok(
      !indexSource.includes(token),
      `index.ts should not reference runtime-specific "${token}"`,
    );
  }
  assert.match(indexSource, /runWorkflow/);
  assert.match(indexSource, /RepositoryVerifier/);
});

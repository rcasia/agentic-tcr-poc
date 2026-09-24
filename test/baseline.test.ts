import test from "node:test";
import assert from "node:assert/strict";

import { runBatchedBaseline } from "../src/baseline.js";
import { EvaluationMetrics } from "../src/metrics.js";

test("baseline accumulates the configured mutations before one verification", async () => {
  const events: string[] = [];
  const persisted: unknown[] = [];
  const metrics = new EvaluationMetrics({
    run: { runId: "baseline-run", startedAt: "2026-09-24T15:00:00.000Z" },
    evidence: { append: (record) => persisted.push(record) },
  });
  const context = { executionId: "baseline-exec", sequence: 1 };

  const result = await runBatchedBaseline(
    context,
    async (mutationContext) => {
      events.push(`capture:${mutationContext.sequence}`);
      return {
        id: `mutation-${mutationContext.sequence}`,
        execution: mutationContext,
        changes: [{ path: `src/${mutationContext.sequence}.ts`, additions: 1, deletions: 0 }],
      };
    },
    async (batch) => {
      events.push(`verify:${batch.id}`);
      return { status: "FAIL", feedback: "failure after batch" };
    },
    { batchSize: 3, metrics },
  );

  assert.deepEqual(events, [
    "capture:1",
    "capture:2",
    "capture:3",
    "verify:batch:baseline-exec:1-3",
  ]);
  assert.equal(result.mutations.length, 3);
  assert.equal(result.batch.changes?.length, 3);
  assert.equal(result.verification.status, "FAIL");
  assert.equal(result.verification.feedback, "failure after batch");

  const metric = metrics.report().records[0];
  assert.equal(metric.verificationMode, "batched");
  assert.equal(metric.unverifiedWorkAtFailure, 3);
  assert.equal(metric.changedFiles, 3);
  assert.equal(persisted.length, 1);
  assert.equal((persisted[0] as { measurement: typeof metric }).measurement.verificationMode, "batched");
  assert.equal((persisted[0] as { measurement: typeof metric }).measurement.unverifiedWorkAtFailure, 3);
});

test("baseline verifies only at the configured boundary and can pass", async () => {
  let verifications = 0;
  const result = await runBatchedBaseline(
    { executionId: "baseline-pass", sequence: 1 },
    async (context) => ({ id: `mutation-${context.sequence}` }),
    async () => {
      verifications += 1;
      return { status: "PASS" };
    },
    { batchSize: 2 },
  );

  assert.equal(verifications, 1);
  assert.equal(result.verification.status, "PASS");
  assert.equal(result.mutations.length, 2);
});

test("baseline rejects invalid batch sizes", async () => {
  await assert.rejects(
    runBatchedBaseline(
      { executionId: "baseline-invalid", sequence: 1 },
      async () => ({ id: "mutation" }),
      async () => ({ status: "PASS" }),
      { batchSize: 0 },
    ),
    /batchSize must be a positive integer/,
  );
});

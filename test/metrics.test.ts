import test from "node:test";
import assert from "node:assert/strict";

import { EvaluationMetrics } from "../src/metrics.js";
import type { Mutation } from "../src/mutation.js";
import { runWorkflow, type RuntimeAdapter } from "../src/workflow.js";

function adapterFor(mutation: Mutation): RuntimeAdapter {
  return {
    async observeMutation() {
      return mutation;
    },
    async interrupt() {},
    async rejectOrRestore() {},
    async sendFeedback() {},
  };
}

test("workflow instrumentation records timing and mutation size", async () => {
  const metrics = new EvaluationMetrics();
  const context = { executionId: "exec-metrics", sequence: 1 };
  const mutation = {
    id: "mutation-metrics-1",
    execution: context,
    changes: [
      { path: "src/a.ts", additions: 3, deletions: 1 },
      { path: "src/b.ts", additions: 2, deletions: 0 },
    ],
  };
  let time = 0;

  await runWorkflow(context, adapterFor(mutation), async () => ({ status: "PASS" }), {
    metrics,
    objectiveId: "objective-1",
    objectiveCompleted: true,
    executionDurationMs: 100,
    now: () => (time += 5),
  });

  const report = metrics.report();
  assert.equal(report.failureRate, 0);
  assert.deepEqual(report.records[0], {
    mutationId: "mutation-metrics-1",
    executionId: "exec-metrics",
    sequence: 1,
    objectiveId: "objective-1",
    verificationMode: "immediate",
    verificationStatus: "PASS",
    changedFiles: 2,
    additions: 5,
    deletions: 1,
    observationLatencyMs: 5,
    verificationLatencyMs: 5,
    recoveryLatencyMs: 0,
    workflowOverheadMs: 10,
    executionDurationMs: 100,
    workflowOverheadRatio: 0.1,
    recoveryIterations: 0,
    objectiveCompleted: true,
  });
  assert.deepEqual(report.objectives, [
    {
      objectiveId: "objective-1",
      completed: true,
      mutations: 1,
      acceptedMutations: 1,
      recoveryIterations: 0,
      mutationsToCompletion: 1,
    },
  ]);
});

test("metrics capture failures, recovery iterations, and unverified work", async () => {
  const metrics = new EvaluationMetrics();
  const context = { executionId: "exec-recovery", sequence: 1 };
  let time = 0;
  const now = () => (time += 5);

  await runWorkflow(
    context,
    adapterFor({ id: "mutation-pass", execution: context }),
    async () => ({ status: "PASS" }),
    { metrics, objectiveId: "objective-2", now },
  );
  await runWorkflow(
    { ...context, sequence: 2 },
    adapterFor({ id: "mutation-fail", execution: { ...context, sequence: 2 } }),
    async () => ({ status: "FAIL", feedback: "failure evidence" }),
    {
      metrics,
      objectiveId: "objective-2",
      verificationMode: "batched",
      executionDurationMs: 100,
      now,
    },
  );
  await runWorkflow(
    { ...context, sequence: 3 },
    adapterFor({ id: "mutation-complete", execution: { ...context, sequence: 3 } }),
    async () => ({ status: "PASS" }),
    { metrics, objectiveId: "objective-2", objectiveCompleted: true, now },
  );

  const report = metrics.report();
  assert.equal(report.totalMutations, 3);
  assert.equal(report.passes, 2);
  assert.equal(report.failures, 1);
  assert.equal(report.failureRate, 1 / 3);
  assert.equal(report.records[1].verificationMode, "batched");
  assert.equal(report.records[1].recoveryIterations, 1);
  assert.equal(report.records[1].unverifiedWorkAtFailure, 1);
  assert.equal(report.records[1].recoveryLatencyMs, 15);
  assert.deepEqual(report.objectives, [
    {
      objectiveId: "objective-2",
      completed: true,
      mutations: 3,
      acceptedMutations: 2,
      recoveryIterations: 1,
      mutationsToCompletion: 3,
    },
  ]);
});

test("empty metrics report has no implied acceptance threshold", () => {
  assert.deepEqual(new EvaluationMetrics().report(), {
    records: [],
    totalMutations: 0,
    passes: 0,
    failures: 0,
    failureRate: 0,
    objectives: [],
  });
});

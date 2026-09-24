import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildEvaluationReport, buildEvaluationReportFromStore } from "../src/evaluation-report.js";
import { EvaluationMetrics } from "../src/metrics.js";
import { JsonlMetricsStore } from "../src/metrics-evidence.js";

function measurement(
  id: string,
  sequence: number,
  verificationStatus: "PASS" | "FAIL",
  verificationLatencyMs: number,
  objectiveCompleted = false,
  objectiveId?: string,
) {
  const context = { executionId: "execution-1", sequence };
  return {
    mutation: {
      id,
      execution: context,
      changes: [{ path: `src/${id}.ts`, additions: sequence, deletions: 1 }],
    },
    executionId: context.executionId,
    verificationStatus,
    verificationMode: "immediate" as const,
    observationLatencyMs: 1,
    verificationLatencyMs,
    interruptLatencyMs: verificationStatus === "FAIL" ? 2 : undefined,
    restoreLatencyMs: verificationStatus === "FAIL" ? 3 : undefined,
    feedbackLatencyMs: verificationStatus === "FAIL" ? 4 : undefined,
    workflowOverheadMs: sequence * 4,
    executionDurationMs: 100,
    objectiveId,
    objectiveCompleted,
  };
}

test("report derives reproducible aggregates from multiple persisted runs", () => {
  const directory = mkdtempSync(join(tmpdir(), "agentic-tcr-report-"));

  try {
    const store = new JsonlMetricsStore(join(directory, "metrics.jsonl"));
    const runOne = new EvaluationMetrics({
      evidence: store,
      run: { runId: "run-1", startedAt: "2026-09-24T15:00:00.000Z" },
    });
    const runTwo = new EvaluationMetrics({
      evidence: store,
      run: { runId: "run-2", startedAt: "2026-09-24T15:01:00.000Z" },
    });

    runOne.record(measurement("m1", 1, "PASS", 10, false, "objective-1"));
    runOne.record(measurement("m2", 2, "FAIL", 20, false, "objective-1"));
    runOne.record(measurement("m3", 3, "PASS", 30, true, "objective-1"));
    runTwo.record(measurement("m4", 4, "PASS", 40));

    const report = buildEvaluationReportFromStore(store);

    assert.equal(report.rawRecords.length, 4);
    assert.deepEqual(report.summary.runIds, ["run-1", "run-2"]);
    assert.deepEqual(report.summary.failure, {
      total: 4,
      failures: 1,
      failureRate: 0.25,
    });
    assert.deepEqual(report.summary.verificationLatency, {
      count: 4,
      median: 25,
      p95: 40,
    });
    assert.deepEqual(report.summary.mutationSize, {
      averageChangedFiles: 1,
      averageAdditions: 2.5,
      averageDeletions: 1,
    });
    assert.deepEqual(report.summary.recovery, {
      totalIterations: 1,
      averageIterationsPerMutation: 0.25,
      unverifiedWorkAtFailure: { count: 1, median: 1, p95: 1 },
    });
    assert.deepEqual(report.summary.workflowOverhead, {
      count: 4,
      median: 10,
      p95: 16,
      totalMs: 40,
      ratioMedian: 0.1,
    });
    assert.deepEqual(report.summary.objectiveCompletion, {
      total: 1,
      completed: 1,
      completionRate: 1,
      objectives: [{
        runId: "run-1",
        objectiveId: "objective-1",
        completed: true,
        mutationCount: 3,
        recoveryIterations: 1,
        mutationsToCompletion: 3,
      }],
    });

    assert.deepEqual(report.rawRecords, store.read());
    assert.equal(buildEvaluationReportFromStore(store, "run-1").rawRecords.length, 3);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("empty report has no invented values or thresholds", () => {
  const report = buildEvaluationReport([]);

  assert.deepEqual(report, {
    rawRecords: [],
    summary: {
      runIds: [],
      failure: { total: 0, failures: 0, failureRate: 0 },
      verificationLatency: { count: 0, median: null, p95: null },
      mutationSize: {
        averageChangedFiles: null,
        averageAdditions: null,
        averageDeletions: null,
      },
      recovery: {
        totalIterations: 0,
        averageIterationsPerMutation: null,
        unverifiedWorkAtFailure: { count: 0, median: null, p95: null },
      },
      workflowOverhead: {
        count: 0,
        median: null,
        p95: null,
        totalMs: 0,
        ratioMedian: null,
      },
      objectiveCompletion: {
        total: 0,
        completed: 0,
        completionRate: 0,
        objectives: [],
      },
    },
  });
});

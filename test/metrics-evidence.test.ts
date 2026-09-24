import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EvaluationMetrics } from "../src/metrics.js";
import { JsonlMetricsStore, MetricsEvidenceError } from "../src/metrics-evidence.js";

function temporaryEvidencePath(): { directory: string; filePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "agentic-tcr-evidence-"));
  return { directory, filePath: join(directory, "metrics.jsonl") };
}

function measurement(id: string, sequence: number) {
  const context = { executionId: "execution-1", sequence };
  return {
    mutation: {
      id,
      execution: context,
      changes: [{ path: "src/example.ts", additions: 2, deletions: 1 }],
    },
    executionId: context.executionId,
    verificationStatus: "PASS" as const,
    verificationMode: "immediate" as const,
    observationLatencyMs: 2,
    verificationLatencyMs: 5,
    workflowOverheadMs: 7,
    executionDurationMs: 100,
    objectiveId: "objective-1",
    objectiveCompleted: sequence === 2,
  };
}

test("JSONL evidence appends multiple runs without overwriting and exports a run", () => {
  const { directory, filePath } = temporaryEvidencePath();

  try {
    const store = new JsonlMetricsStore(filePath);
    const firstRun = new EvaluationMetrics({
      evidence: store,
      run: {
        runId: "run-1",
        startedAt: "2026-09-24T15:00:00.000Z",
        executionId: "execution-1",
        objectiveId: "objective-1",
        verificationMode: "immediate",
      },
    });
    const secondRun = new EvaluationMetrics({
      evidence: store,
      run: { runId: "run-2", startedAt: "2026-09-24T15:01:00.000Z" },
    });

    firstRun.record(measurement("mutation-1", 1));
    secondRun.record(measurement("mutation-2", 2));

    const allRecords = store.read();
    assert.equal(allRecords.length, 2);
    assert.equal(store.read("run-1").length, 1);
    assert.equal(store.read("run-1")[0].mutationSequence, 1);
    assert.equal(store.read("run-2")[0].run.runId, "run-2");
    assert.equal(JSON.parse(store.exportRun("run-1")).run.runId, "run-1");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("persisted records contain the raw per-mutation RFC metrics", () => {
  const { directory, filePath } = temporaryEvidencePath();

  try {
    const store = new JsonlMetricsStore(filePath);
    const metrics = new EvaluationMetrics({
      evidence: store,
      run: { runId: "run-raw", startedAt: "2026-09-24T15:00:00.000Z" },
    });
    metrics.record(measurement("mutation-raw", 1));

    assert.deepEqual(store.read("run-raw")[0].measurement, metrics.report().records[0]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("missing evidence is empty and malformed evidence reports its line", () => {
  const { directory, filePath } = temporaryEvidencePath();

  try {
    const store = new JsonlMetricsStore(filePath);
    assert.deepEqual(store.read(), []);

    writeFileSync(filePath, "not-json\n");
    assert.throws(
      () => store.read(),
      (error: unknown) => error instanceof MetricsEvidenceError
        && /line 1/.test(error.message),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("evidence persistence requires run metadata but never changes the report", () => {
  assert.throws(
    () => new EvaluationMetrics({ evidence: new JsonlMetricsStore("metrics.jsonl") }),
    /requires run metadata/,
  );
});

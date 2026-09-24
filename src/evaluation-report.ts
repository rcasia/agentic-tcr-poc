import type {
  PersistedMetricRecord,
} from "./metrics.js";
import type { JsonlMetricsStore } from "./metrics-evidence.js";

export type DistributionSummary = {
  count: number;
  median: number | null;
  p95: number | null;
};

export type MutationSizeSummary = {
  averageChangedFiles: number | null;
  averageAdditions: number | null;
  averageDeletions: number | null;
};

export type FailureSummary = {
  total: number;
  failures: number;
  failureRate: number;
};

export type RecoverySummary = {
  totalIterations: number;
  averageIterationsPerMutation: number | null;
  unverifiedWorkAtFailure: DistributionSummary;
};

export type ObjectiveSummary = {
  runId: string;
  objectiveId: string;
  completed: boolean;
  mutationCount: number;
  recoveryIterations: number;
  mutationsToCompletion: number | null;
};

export type ObjectiveCompletionSummary = {
  total: number;
  completed: number;
  completionRate: number;
  objectives: readonly ObjectiveSummary[];
};

export type EvaluationSummary = {
  runIds: readonly string[];
  failure: FailureSummary;
  verificationLatency: DistributionSummary;
  mutationSize: MutationSizeSummary;
  recovery: RecoverySummary;
  workflowOverhead: DistributionSummary & {
    totalMs: number;
    ratioMedian: number | null;
  };
  objectiveCompletion: ObjectiveCompletionSummary;
};

/** Raw records remain separate from the derived summary. */
export type EvaluationReport = {
  rawRecords: readonly PersistedMetricRecord[];
  summary: EvaluationSummary;
};

export function buildEvaluationReport(
  records: readonly PersistedMetricRecord[],
): EvaluationReport {
  const measurements = records.map(({ measurement }) => measurement);
  const failures = measurements.filter(({ verificationStatus }) => verificationStatus === "FAIL").length;
  const objectiveSummaries = buildObjectiveSummaries(records);
  const unverifiedWork = measurements
    .filter((measurement) => measurement.unverifiedWorkAtFailure !== undefined)
    .map((measurement) => measurement.unverifiedWorkAtFailure as number);
  const recoveryIterations = measurements.reduce(
    (total, measurement) => total + (measurement.verificationStatus === "FAIL" ? 1 : 0),
    0,
  );
  const verificationLatency = distribution(measurements.map(({ verificationLatencyMs }) => verificationLatencyMs));
  const workflowOverhead = distribution(measurements.map(({ workflowOverheadMs }) => workflowOverheadMs));
  const workflowRatios = measurements
    .filter(({ workflowOverheadRatio }) => workflowOverheadRatio !== undefined)
    .map(({ workflowOverheadRatio }) => workflowOverheadRatio as number);

  return {
    rawRecords: records.map((record) => ({
      ...record,
      run: { ...record.run },
      measurement: { ...record.measurement },
    })),
    summary: {
      runIds: [...new Set(records.map(({ run }) => run.runId))],
      failure: {
        total: measurements.length,
        failures,
        failureRate: measurements.length === 0 ? 0 : failures / measurements.length,
      },
      verificationLatency,
      mutationSize: {
        averageChangedFiles: average(measurements.map(({ changedFiles }) => changedFiles)),
        averageAdditions: average(measurements.map(({ additions }) => additions)),
        averageDeletions: average(measurements.map(({ deletions }) => deletions)),
      },
      recovery: {
        totalIterations: recoveryIterations,
        averageIterationsPerMutation: measurements.length === 0
          ? null
          : recoveryIterations / measurements.length,
        unverifiedWorkAtFailure: distribution(unverifiedWork),
      },
      workflowOverhead: {
        ...workflowOverhead,
        totalMs: measurements.reduce((total, { workflowOverheadMs }) => total + workflowOverheadMs, 0),
        ratioMedian: median(workflowRatios),
      },
      objectiveCompletion: {
        total: objectiveSummaries.length,
        completed: objectiveSummaries.filter(({ completed }) => completed).length,
        completionRate: objectiveSummaries.length === 0
          ? 0
          : objectiveSummaries.filter(({ completed }) => completed).length / objectiveSummaries.length,
        objectives: objectiveSummaries,
      },
    },
  };
}

export function buildEvaluationReportFromStore(
  store: Pick<JsonlMetricsStore, "read">,
  runId?: string,
): EvaluationReport {
  return buildEvaluationReport(store.read(runId));
}

function buildObjectiveSummaries(
  records: readonly PersistedMetricRecord[],
): ObjectiveSummary[] {
  const grouped = new Map<string, PersistedMetricRecord[]>();

  for (const record of records) {
    const objectiveId = record.measurement.objectiveId;
    if (objectiveId === undefined) {
      continue;
    }
    const key = `${record.run.runId}:${objectiveId}`;
    const group = grouped.get(key) ?? [];
    group.push(record);
    grouped.set(key, group);
  }

  return [...grouped].map(([key, group]) => {
    const first = group[0];
    const completedIndex = group.findIndex(({ measurement }) => measurement.objectiveCompleted);
    return {
      runId: first.run.runId,
      objectiveId: key.slice(first.run.runId.length + 1),
      completed: completedIndex >= 0,
      mutationCount: group.length,
      recoveryIterations: group.filter(({ measurement }) => measurement.verificationStatus === "FAIL").length,
      mutationsToCompletion: completedIndex < 0 ? null : completedIndex + 1,
    };
  });
}

function distribution(values: readonly number[]): DistributionSummary {
  return {
    count: values.length,
    median: median(values),
    p95: percentile(values, 0.95),
  };
}

function average(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentile(values: readonly number[], percentileValue: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index];
}

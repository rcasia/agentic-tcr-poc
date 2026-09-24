import type { Mutation } from "./mutation.js";

export type VerificationMode = "immediate" | "batched";

export type WorkflowMeasurement = {
  mutation: Mutation;
  executionId: string;
  verificationStatus: "PASS" | "FAIL";
  verificationMode: VerificationMode;
  observationLatencyMs: number;
  verificationLatencyMs: number;
  interruptLatencyMs?: number;
  restoreLatencyMs?: number;
  feedbackLatencyMs?: number;
  workflowOverheadMs: number;
  executionDurationMs?: number;
  objectiveId?: string;
  objectiveCompleted: boolean;
};

export type MutationMetrics = {
  mutationId: string;
  executionId: string;
  sequence: number;
  objectiveId?: string;
  verificationMode: VerificationMode;
  verificationStatus: "PASS" | "FAIL";
  changedFiles: number;
  additions: number;
  deletions: number;
  observationLatencyMs: number;
  verificationLatencyMs: number;
  interruptLatencyMs?: number;
  restoreLatencyMs?: number;
  feedbackLatencyMs?: number;
  recoveryLatencyMs: number;
  workflowOverheadMs: number;
  executionDurationMs?: number;
  workflowOverheadRatio?: number;
  recoveryIterations: number;
  unverifiedWorkAtFailure?: number;
  objectiveCompleted: boolean;
};

export type ObjectiveMetrics = {
  objectiveId: string;
  completed: boolean;
  mutations: number;
  acceptedMutations: number;
  recoveryIterations: number;
  mutationsToCompletion?: number;
};

export type EvaluationReport = {
  records: readonly MutationMetrics[];
  totalMutations: number;
  passes: number;
  failures: number;
  failureRate: number;
  objectives: readonly ObjectiveMetrics[];
};

export type MetricsRecorder = {
  record(measurement: WorkflowMeasurement): void;
  report(): EvaluationReport;
};

type ObjectiveState = {
  completed: boolean;
  mutations: number;
  acceptedMutations: number;
  recoveryIterationsTotal: number;
  recoveryIterationsSinceAccepted: number;
  mutationsSinceAccepted: number;
  mutationsToCompletion?: number;
};

/** Passive evidence collector; it never decides whether a mutation passes. */
export class EvaluationMetrics implements MetricsRecorder {
  private readonly records: MutationMetrics[] = [];
  private readonly objectives = new Map<string, ObjectiveState>();

  record(measurement: WorkflowMeasurement): void {
    const state = measurement.objectiveId === undefined
      ? undefined
      : this.objectives.get(measurement.objectiveId) ?? this.newObjective(measurement.objectiveId);
    const unverifiedWork = (state?.mutationsSinceAccepted ?? 0) + 1;
    const isFailure = measurement.verificationStatus === "FAIL";
    const recoveryIterations = (state?.recoveryIterationsSinceAccepted ?? 0)
      + (isFailure ? 1 : 0);
    const recoveryLatencyMs = isFailure
      ? (measurement.interruptLatencyMs ?? 0)
        + (measurement.restoreLatencyMs ?? 0)
        + (measurement.feedbackLatencyMs ?? 0)
      : 0;
    const workflowOverheadRatio = calculateRatio(
      measurement.workflowOverheadMs,
      measurement.executionDurationMs,
    );
    const metric: MutationMetrics = {
      mutationId: measurement.mutation.id,
      executionId: measurement.executionId,
      sequence: measurement.mutation.execution?.sequence ?? 0,
      objectiveId: measurement.objectiveId,
      verificationMode: measurement.verificationMode,
      verificationStatus: measurement.verificationStatus,
      changedFiles: measurement.mutation.changes?.length ?? 0,
      additions: sumChanges(measurement.mutation, "additions"),
      deletions: sumChanges(measurement.mutation, "deletions"),
      observationLatencyMs: measurement.observationLatencyMs,
      verificationLatencyMs: measurement.verificationLatencyMs,
      recoveryLatencyMs,
      workflowOverheadMs: measurement.workflowOverheadMs,
      recoveryIterations,
      objectiveCompleted: measurement.objectiveCompleted,
      ...(measurement.interruptLatencyMs === undefined
        ? {}
        : { interruptLatencyMs: measurement.interruptLatencyMs }),
      ...(measurement.restoreLatencyMs === undefined
        ? {}
        : { restoreLatencyMs: measurement.restoreLatencyMs }),
      ...(measurement.feedbackLatencyMs === undefined
        ? {}
        : { feedbackLatencyMs: measurement.feedbackLatencyMs }),
      ...(measurement.executionDurationMs === undefined
        ? {}
        : { executionDurationMs: measurement.executionDurationMs }),
      ...(workflowOverheadRatio === undefined
        ? {}
        : { workflowOverheadRatio }),
      ...(isFailure ? { unverifiedWorkAtFailure: unverifiedWork } : {}),
    };

    this.records.push(metric);

    if (state !== undefined) {
      state.mutations += 1;
      state.recoveryIterationsTotal += isFailure ? 1 : 0;
      state.recoveryIterationsSinceAccepted = isFailure ? recoveryIterations : 0;
      state.mutationsSinceAccepted = isFailure ? unverifiedWork : 0;
      if (!isFailure) {
        state.acceptedMutations += 1;
      }
      if (measurement.objectiveCompleted) {
        state.completed = true;
        state.mutationsToCompletion ??= state.mutations;
      }
    }
  }

  report(): EvaluationReport {
    const failures = this.records.filter(({ verificationStatus }) => verificationStatus === "FAIL").length;
    return {
      records: [...this.records],
      totalMutations: this.records.length,
      passes: this.records.length - failures,
      failures,
      failureRate: this.records.length === 0 ? 0 : failures / this.records.length,
      objectives: [...this.objectives].map(([objectiveId, state]) => ({
        objectiveId,
        completed: state.completed,
        mutations: state.mutations,
        acceptedMutations: state.acceptedMutations,
        recoveryIterations: state.recoveryIterationsTotal,
        mutationsToCompletion: state.mutationsToCompletion,
      })),
    };
  }

  private newObjective(objectiveId: string): ObjectiveState {
    const state: ObjectiveState = {
      completed: false,
      mutations: 0,
      acceptedMutations: 0,
      recoveryIterationsTotal: 0,
      recoveryIterationsSinceAccepted: 0,
      mutationsSinceAccepted: 0,
    };
    this.objectives.set(objectiveId, state);
    return state;
  }
}

function sumChanges(
  mutation: Mutation,
  field: "additions" | "deletions",
): number {
  return mutation.changes?.reduce((total, change) => total + (change[field] ?? 0), 0) ?? 0;
}

function calculateRatio(overheadMs: number, executionDurationMs?: number): number | undefined {
  return executionDurationMs === undefined || executionDurationMs <= 0
    ? undefined
    : overheadMs / executionDurationMs;
}

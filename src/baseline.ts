import type { ExecutionContext, FileChange, Mutation } from "./mutation.js";
import type {
  MetricsRecorder,
  VerificationMode,
  WorkflowMeasurement,
} from "./metrics.js";
import type {
  VerificationResult,
  Verifier,
} from "./verification.js";

export type MutationSource = (context: ExecutionContext) => Promise<Mutation>;

export type BaselineOptions = {
  batchSize: number;
  metrics?: MetricsRecorder;
  objectiveId?: string;
  objectiveCompleted?: boolean;
  executionDurationMs?: number;
  now?: () => number;
};

export type BaselineResult = {
  verification: VerificationResult;
  mutations: readonly Mutation[];
  batch: Mutation;
};

/**
 * Runs the non-TCR comparison strategy: capture N mutations, then verify once.
 * It deliberately has no interrupt, restore, or acceptance behavior.
 */
export async function runBatchedBaseline(
  context: ExecutionContext,
  source: MutationSource,
  verify: Verifier,
  options: BaselineOptions,
): Promise<BaselineResult> {
  assertBatchSize(options.batchSize);
  const now = options.now ?? (() => performance.now());
  const observationStartedAt = now();
  const mutations: Mutation[] = [];

  for (let index = 0; index < options.batchSize; index += 1) {
    const mutationContext = {
      ...context,
      sequence: context.sequence + index,
    };
    const captured = await source(mutationContext);
    mutations.push(associateExecution(captured, mutationContext));
  }

  const observationLatencyMs = now() - observationStartedAt;
  const batch = combineMutations(context, mutations);
  const verificationStartedAt = now();
  const verification = await verify(batch);
  const verificationLatencyMs = now() - verificationStartedAt;

  recordMetrics(options.metrics, {
    mutation: batch,
    context,
    verificationStatus: verification.status,
    verificationMode: "batched",
    observationLatencyMs,
    verificationLatencyMs,
    workflowOverheadMs: observationLatencyMs + verificationLatencyMs,
    unverifiedWorkAtFailure: verification.status === "FAIL" ? mutations.length : undefined,
    options,
  });

  return { verification, mutations, batch };
}

function assertBatchSize(batchSize: number): void {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("Baseline batchSize must be a positive integer");
  }
}

function associateExecution(
  mutation: Mutation,
  context: ExecutionContext,
): Mutation {
  return mutation.execution === undefined
    ? { ...mutation, execution: context }
    : mutation;
}

function combineMutations(
  context: ExecutionContext,
  mutations: readonly Mutation[],
): Mutation {
  const first = mutations[0];
  const last = mutations[mutations.length - 1];
  const changes: FileChange[] = mutations.flatMap((mutation) => mutation.changes ?? []);

  return {
    id: `batch:${context.executionId}:${context.sequence}-${last.execution?.sequence ?? context.sequence}`,
    execution: {
      ...context,
      sequence: last.execution?.sequence ?? context.sequence,
    },
    description: `${mutations.length} mutation(s) accumulated before verification`,
    changes,
    capturedAt: first.capturedAt,
  };
}

function recordMetrics(
  metrics: MetricsRecorder | undefined,
  input: {
    mutation: Mutation;
    context: ExecutionContext;
    verificationStatus: "PASS" | "FAIL";
    verificationMode: VerificationMode;
    observationLatencyMs: number;
    verificationLatencyMs: number;
    workflowOverheadMs: number;
    unverifiedWorkAtFailure?: number;
    options: BaselineOptions;
  },
): void {
  if (metrics === undefined) {
    return;
  }

  const measurement: WorkflowMeasurement = {
    mutation: input.mutation,
    executionId: input.context.executionId,
    verificationStatus: input.verificationStatus,
    verificationMode: input.verificationMode,
    observationLatencyMs: input.observationLatencyMs,
    verificationLatencyMs: input.verificationLatencyMs,
    workflowOverheadMs: input.workflowOverheadMs,
    executionDurationMs: input.options.executionDurationMs,
    unverifiedWorkAtFailure: input.unverifiedWorkAtFailure,
    objectiveId: input.options.objectiveId,
    objectiveCompleted: input.options.objectiveCompleted ?? false,
  };
  metrics.record(measurement);
}

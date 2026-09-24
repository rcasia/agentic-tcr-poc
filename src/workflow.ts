import type {
  ExecutionContext,
  Mutation,
} from "./mutation.js";
import {
  assertMutationContext,
  type MutationScopeGuard,
} from "./mutation.js";
import {
  type MetricsRecorder,
  type VerificationMode,
  type WorkflowMeasurement,
} from "./metrics.js";
import {
  supervise,
  type SupervisorDecision,
  type Verifier,
} from "./supervisor.js";

/**
 * The execution context made available for the next agent turn.
 *
 * In this POC, feedback delivery is also the continuation mechanism. A
 * separate `continue` operation would duplicate that runtime capability.
 */
export type RuntimeContinuation = {
  context: ExecutionContext;
};

/**
 * Runtime capabilities required by the generic TCR workflow.
 *
 * Implementations own runtime-specific identifiers and API calls. The
 * controller only supplies the execution context and captured mutation.
 */
export type RuntimeAdapter = {
  observeMutation(context: ExecutionContext): Promise<Mutation>;
  interrupt(context: ExecutionContext): Promise<boolean | void>;
  rejectOrRestore(
    context: ExecutionContext,
    mutation: Mutation,
  ): Promise<boolean | void>;
  sendFeedback(
    context: ExecutionContext,
    feedback?: string,
  ): Promise<RuntimeContinuation>;
};

export type WorkflowResult = {
  context: ExecutionContext;
  decision: SupervisorDecision;
};

export type WorkflowOptions = {
  metrics?: MetricsRecorder;
  scopeGuard?: MutationScopeGuard;
  objectiveId?: string;
  objectiveCompleted?: boolean;
  verificationMode?: VerificationMode;
  executionDurationMs?: number;
  now?: () => number;
};

/**
 * Captures and verifies one mutation, recovering failures in the same
 * execution context before returning control to the caller.
 */
export async function runWorkflow(
  context: ExecutionContext,
  adapter: RuntimeAdapter,
  verify: Verifier,
  options: WorkflowOptions = {},
): Promise<WorkflowResult> {
  options.scopeGuard?.validate(context);
  const now = options.now ?? (() => performance.now());
  const observationStartedAt = now();
  const capturedMutation = await adapter.observeMutation(context);
  const observationLatencyMs = now() - observationStartedAt;
  const mutation = associateExecution(capturedMutation, context);
  const verificationStartedAt = now();
  const decision = await supervise(mutation, verify);
  const verificationLatencyMs = now() - verificationStartedAt;

  if (decision.type === "ACCEPT") {
    recordMetrics(options.metrics, {
      mutation,
      context,
      verificationStatus: "PASS",
      observationLatencyMs,
      verificationLatencyMs,
      workflowOverheadMs: observationLatencyMs + verificationLatencyMs,
      options,
    });
    return { context, decision };
  }

  const interruptStartedAt = now();
  await adapter.interrupt(context);
  const interruptLatencyMs = now() - interruptStartedAt;
  const restoreStartedAt = now();
  await adapter.rejectOrRestore(context, mutation);
  const restoreLatencyMs = now() - restoreStartedAt;
  const feedbackStartedAt = now();
  const continuation = await adapter.sendFeedback(context, decision.feedback);
  const feedbackLatencyMs = now() - feedbackStartedAt;

  if (continuation.context.executionId !== context.executionId) {
    throw new Error("Runtime continuation changed the execution context");
  }

  recordMetrics(options.metrics, {
    mutation,
    context,
    verificationStatus: "FAIL",
    observationLatencyMs,
    verificationLatencyMs,
    interruptLatencyMs,
    restoreLatencyMs,
    feedbackLatencyMs,
    workflowOverheadMs: observationLatencyMs
      + verificationLatencyMs
      + interruptLatencyMs
      + restoreLatencyMs
      + feedbackLatencyMs,
    options,
  });

  return { context: continuation.context, decision };
}

function recordMetrics(
  metrics: MetricsRecorder | undefined,
  input: {
    mutation: Mutation;
    context: ExecutionContext;
    verificationStatus: "PASS" | "FAIL";
    observationLatencyMs: number;
    verificationLatencyMs: number;
    interruptLatencyMs?: number;
    restoreLatencyMs?: number;
    feedbackLatencyMs?: number;
    workflowOverheadMs: number;
    options: WorkflowOptions;
  },
): void {
  if (metrics === undefined) {
    return;
  }

  const measurement: WorkflowMeasurement = {
    mutation: input.mutation,
    executionId: input.context.executionId,
    verificationStatus: input.verificationStatus,
    verificationMode: input.options.verificationMode ?? "immediate",
    observationLatencyMs: input.observationLatencyMs,
    verificationLatencyMs: input.verificationLatencyMs,
    interruptLatencyMs: input.interruptLatencyMs,
    restoreLatencyMs: input.restoreLatencyMs,
    feedbackLatencyMs: input.feedbackLatencyMs,
    workflowOverheadMs: input.workflowOverheadMs,
    executionDurationMs: input.options.executionDurationMs,
    objectiveId: input.options.objectiveId,
    objectiveCompleted: input.options.objectiveCompleted ?? false,
  };
  metrics.record(measurement);
}

function associateExecution(
  mutation: Mutation,
  context: ExecutionContext,
): Mutation {
  const associated = mutation.execution === undefined
    ? { ...mutation, execution: context }
    : mutation;
  assertMutationContext(associated, context);
  return associated;
}

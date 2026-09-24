import type {
  ExecutionContext,
  Mutation,
} from "./mutation.js";
import {
  supervise,
  type SupervisorDecision,
  type Verifier,
} from "./supervisor.js";

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
  ): Promise<void>;
};

export type WorkflowResult = {
  context: ExecutionContext;
  decision: SupervisorDecision;
};

/**
 * Captures and verifies one mutation, recovering failures in the same
 * execution context before returning control to the caller.
 */
export async function runWorkflow(
  context: ExecutionContext,
  adapter: RuntimeAdapter,
  verify: Verifier,
): Promise<WorkflowResult> {
  const capturedMutation = await adapter.observeMutation(context);
  const mutation = associateExecution(capturedMutation, context);
  const decision = await supervise(mutation, verify);

  if (decision.type === "ACCEPT") {
    return { context, decision };
  }

  await adapter.interrupt(context);
  await adapter.rejectOrRestore(context, mutation);
  await adapter.sendFeedback(context, decision.feedback);

  return { context, decision };
}

function associateExecution(
  mutation: Mutation,
  context: ExecutionContext,
): Mutation {
  return mutation.execution === undefined
    ? { ...mutation, execution: context }
    : mutation;
}

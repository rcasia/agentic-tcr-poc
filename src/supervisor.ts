import type { Mutation } from "./mutation.js";

export type { ExecutionContext, FileChange, Mutation } from "./mutation.js";

export type VerificationResult = {
  status: "PASS" | "FAIL";
  feedback?: string;
};

export type SupervisorDecision =
  | { type: "ACCEPT"; mutation: Mutation }
  | { type: "REJECT"; mutation: Mutation; feedback?: string };

export type Verifier = (mutation: Mutation) => Promise<VerificationResult>;

/**
 * Deterministic acceptance controller for the Agentic TCR workflow.
 *
 * The supervisor owns the acceptance decision. The agent does not.
 */
export async function supervise(
  mutation: Mutation,
  verify: Verifier,
): Promise<SupervisorDecision> {
  const result = await verify(mutation);

  if (result.status === "PASS") {
    return { type: "ACCEPT", mutation };
  }

  return {
    type: "REJECT",
    mutation,
    feedback: result.feedback,
  };
}

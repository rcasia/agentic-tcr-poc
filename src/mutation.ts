/**
 * Generic mutation domain for the Agentic TCR workflow.
 *
 * This module is runtime-agnostic. It MUST NOT import or depend on
 * OpenCode types, SDK clients, or any runtime-specific API shapes.
 * Runtime-specific behavior lives in adapter layers (e.g.
 * `src/opencode-adapter.ts`), which map concrete runtime handles onto
 * the generic correlation keys defined here.
 *
 * POC model: one agent / one workspace / sequential mutations.
 */

/**
 * Identifies the execution that produced a mutation.
 *
 * The supervisor treats this opaquely: it preserves the context through
 * ACCEPT/REJECT decisions so the runtime adapter can guarantee
 * "INTERRUPT SAME EXECUTION -> REJECT/RESTORE -> FEEDBACK ->
 * CONTINUE SAME EXECUTION".
 */
export type ExecutionContext = {
  /** Stable identity of the agent execution (opaque to the supervisor). */
  executionId: string;
  /** Optional workspace scope (e.g. worktree). Single workspace in the POC. */
  workspaceId?: string;
  /** Optional caller-defined file scope within the workspace. */
  scopeId?: string;
  /**
   * Monotonic sequence number within the execution.
   * Enforces the POC's sequential-mutation ordering.
   */
  sequence: number;
};

/**
 * Generic, runtime-independent summary of a single changed file.
 *
 * Only counts/summaries are kept here. Full before/after contents stay
 * with the runtime adapter's concrete diff payload.
 */
export type FileChange = {
  /** Workspace-relative file path. */
  path: string;
  /** Optional human-readable summary of the change. */
  summary?: string;
  additions?: number;
  deletions?: number;
};

/**
 * A concrete change set captured by the workflow and presented to
 * verification as one unit. A mutation may span multiple files when
 * those changes form one captured unit.
 *
 * Correlation contract for recovery:
 * - `id` plus `execution` give the runtime adapter enough information
 *   to resolve the mutation back to its concrete restore handle
 *   (via an adapter-side mapping). The generic model does not carry
 *   the concrete handle itself; see "Intentionally omitted fields".
 */
export type Mutation = {
  /** Stable correlation identity for the captured mutation. */
  id: string;
  /** Optional human-readable description of the change. */
  description?: string;
  /** Which execution produced this mutation (for same-execution recovery). */
  execution?: ExecutionContext;
  /** Generic summary of changed files in this mutation. */
  changes?: FileChange[];
  /** ISO-8601 capture timestamp, for ordering/debug. */
  capturedAt?: string;
};

export class MutationContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationContextError";
  }
}

/** Validates that a captured mutation belongs to the current execution scope. */
export function assertMutationContext(
  mutation: Mutation,
  context: ExecutionContext,
): void {
  const execution = mutation.execution;
  if (execution === undefined) {
    throw new MutationContextError("Mutation has no execution context");
  }
  if (execution.executionId !== context.executionId) {
    throw new MutationContextError("Mutation belongs to a different execution");
  }
  if (execution.workspaceId !== undefined
    && context.workspaceId !== undefined
    && execution.workspaceId !== context.workspaceId) {
    throw new MutationContextError("Mutation belongs to a different workspace");
  }
  if (execution.scopeId !== undefined
    && context.scopeId !== undefined
    && execution.scopeId !== context.scopeId) {
    throw new MutationContextError("Mutation belongs to a different file scope");
  }
  if (execution.sequence !== context.sequence) {
    throw new MutationContextError("Mutation sequence does not match the execution context");
  }
}

type ScopeState = {
  workspaceId?: string;
  scopeId?: string;
  sequence: number;
};

/**
 * Optional stateful boundary for the POC's sequential execution assumption.
 * It enforces ordering and stable workspace/scope identity, but never limits
 * the number of files or lines in a mutation.
 */
export class MutationScopeGuard {
  private readonly executions = new Map<string, ScopeState>();

  validate(context: ExecutionContext): void {
    if (!Number.isInteger(context.sequence) || context.sequence < 1) {
      throw new MutationContextError("Execution sequence must be a positive integer");
    }

    const previous = this.executions.get(context.executionId);
    if (previous === undefined) {
      this.executions.set(context.executionId, {
        workspaceId: context.workspaceId,
        scopeId: context.scopeId,
        sequence: context.sequence,
      });
      return;
    }

    if (previous.workspaceId !== undefined
      && context.workspaceId !== undefined
      && previous.workspaceId !== context.workspaceId) {
      throw new MutationContextError("Execution changed workspace");
    }
    if (previous.scopeId !== undefined
      && context.scopeId !== undefined
      && previous.scopeId !== context.scopeId) {
      throw new MutationContextError("Execution changed file scope");
    }
    if (context.sequence <= previous.sequence) {
      throw new MutationContextError("Mutation sequence must increase within an execution");
    }

    this.executions.set(context.executionId, {
      workspaceId: context.workspaceId ?? previous.workspaceId,
      scopeId: context.scopeId ?? previous.scopeId,
      sequence: context.sequence,
    });
  }
}

/**
 * Intentionally omitted fields (belong to the adapter, not the domain):
 *
 * - `sessionId` / `session.id` (e.g. `ses_...`): OpenCode-specific
 *   execution addressing. The generic equivalent is
 *   `ExecutionContext.executionId`. The adapter maps one to the other.
 * - `messageID` (e.g. `msg_...`) and `partID` (e.g. `prt_...`):
 *   OpenCode-specific restore handles needed for `session.revert`.
 *   Kept in adapter-facing structures (see issue #3) so supervisor
 *   logic never branches on runtime identifier formats. The adapter
 *   resolves generic `Mutation.id` (+ `execution`) to these handles
 *   via a sidecar mapping.
 * - `before` / `after` file contents and full diff payloads: concrete
 *   observation data in the runtime's diff format. The supervisor only
 *   needs the generic `FileChange` summary; carrying full contents
 *   would couple the domain to the runtime diff shape and bloat the
 *   acceptance decision path.
 * - `OpenCodeClient` and `session.diff/abort/revert/prompt` shapes:
 *   runtime transport APIs. The supervisor consumes only the generic
 *   `Verifier` result (PASS/FAIL); orchestration of runtime calls
 *   belongs to the workflow controller + adapter (issues #2/#3).
 */

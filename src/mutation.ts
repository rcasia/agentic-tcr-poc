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

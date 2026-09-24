import type {
  OpenCodeClient as OfficialOpenCodeClient,
} from "@opencode/client";
import type { ExecutionContext, Mutation } from "./mutation.js";
import type { RuntimeAdapter, RuntimeContinuation } from "./workflow.js";

type OfficialSessionClient = OfficialOpenCodeClient["session"];

/** The subset of the generated OpenCode client used by this adapter. */
export type OpenCodeClient = {
  session: Pick<OfficialSessionClient, "diff" | "interrupt" | "prompt"> & {
    revert: Pick<OfficialSessionClient["revert"], "stage" | "commit">;
  };
};

export type OpenCodeMutationHandle = {
  messageID: string;
  /** Kept for runtimes exposing part-level restore; v2 restores at message boundaries. */
  partID?: string;
};

export type OpenCodeMutationHandleProvider = (
  context: ExecutionContext,
) => OpenCodeMutationHandle;

/**
 * Runtime adapter for an already-running OpenCode session.
 *
 * The adapter observes and controls the runtime. It does not decide PASS/FAIL
 * or acceptance; those decisions belong to the supervisor.
 */
export class OpenCodeAdapter implements RuntimeAdapter {
  private readonly restoreHandles = new Map<string, OpenCodeMutationHandle>();

  constructor(
    private readonly client: OpenCodeClient,
    private readonly sessionId: string,
    private readonly mutationHandleFor: OpenCodeMutationHandleProvider,
  ) {}

  async observeMutation(context: ExecutionContext): Promise<Mutation> {
    const handle = this.mutationHandleFor(context);
    const diff = await this.client.session.diff({
      sessionID: this.sessionId,
      from: handle.messageID,
    });
    const mutationId = `mutation:${context.executionId}:${context.sequence}`;

    this.restoreHandles.set(mutationId, handle);

    return {
      id: mutationId,
      execution: context,
      description: `${diff.length} changed file(s) observed in OpenCode session`,
      changes: diff.map(({ file, additions, deletions }) => ({
        path: file,
        additions,
        deletions,
      })),
    };
  }

  async interrupt(_context: ExecutionContext): Promise<boolean> {
    const result = await this.client.session.interrupt({ sessionID: this.sessionId });
    return result.interrupted;
  }

  async rejectOrRestore(
    _context: ExecutionContext,
    mutation: Mutation,
  ): Promise<boolean> {
    const handle = this.restoreHandles.get(mutation.id);

    if (handle === undefined) {
      throw new Error(`No OpenCode restore handle for mutation ${mutation.id}`);
    }

    await this.client.session.revert.stage({
      sessionID: this.sessionId,
      messageID: handle.messageID,
      files: true,
    });
    await this.client.session.revert.commit({ sessionID: this.sessionId });
    return true;
  }

  async sendFeedback(
    context: ExecutionContext,
    text?: string,
  ): Promise<RuntimeContinuation> {
    // `steer` delivers feedback to this session without waiting for a new
    // assistant response, so recovery can return control to the same runtime.
    await this.client.session.prompt({
      sessionID: this.sessionId,
      text: text ?? "",
      delivery: "steer",
    });
    return { context };
  }
}

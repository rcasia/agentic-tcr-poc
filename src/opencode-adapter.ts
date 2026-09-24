import type { ExecutionContext, Mutation } from "./mutation.js";
import type { RuntimeAdapter } from "./workflow.js";

export type FileDiff = {
  file: string;
  before?: string;
  after?: string;
  additions?: number;
  deletions?: number;
};

export type OpenCodeClient = {
  session: {
    diff(input: { path: { id: string }; query?: { messageID?: string } }): Promise<FileDiff[]>;
    abort(input: { path: { id: string } }): Promise<boolean>;
    revert(input: { path: { id: string }; body: { messageID: string; partID?: string } }): Promise<boolean>;
    prompt(input: { path: { id: string }; body: { text: string } }): Promise<unknown>;
  };
};

export type OpenCodeMutationHandle = {
  messageID: string;
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
      path: { id: this.sessionId },
      query: { messageID: handle.messageID },
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
    return this.client.session.abort({ path: { id: this.sessionId } });
  }

  async rejectOrRestore(
    _context: ExecutionContext,
    mutation: Mutation,
  ): Promise<boolean> {
    const handle = this.restoreHandles.get(mutation.id);

    if (handle === undefined) {
      throw new Error(`No OpenCode restore handle for mutation ${mutation.id}`);
    }

    return this.client.session.revert({
      path: { id: this.sessionId },
      body: handle,
    });
  }

  async sendFeedback(_context: ExecutionContext, text?: string): Promise<void> {
    await this.client.session.prompt({
      path: { id: this.sessionId },
      body: { text: text ?? "" },
    });
  }
}

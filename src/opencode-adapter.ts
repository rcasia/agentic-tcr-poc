import type { Mutation } from "./supervisor";

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

/**
 * Runtime adapter for an already-running OpenCode session.
 *
 * The adapter observes and controls the runtime. It does not decide PASS/FAIL
 * or acceptance; those decisions belong to the supervisor.
 */
export class OpenCodeAdapter {
  constructor(
    private readonly client: OpenCodeClient,
    private readonly sessionId: string,
  ) {}

  async observeMutation(messageID?: string): Promise<Mutation> {
    const diff = await this.client.session.diff({
      path: { id: this.sessionId },
      query: messageID ? { messageID } : undefined,
    });

    return {
      id: messageID ?? `opencode:${this.sessionId}`,
      description: `${diff.length} changed file(s) observed in OpenCode session`,
    };
  }

  async interrupt(): Promise<boolean> {
    return this.client.session.abort({ path: { id: this.sessionId } });
  }

  async rejectOrRestore(messageID: string, partID?: string): Promise<boolean> {
    return this.client.session.revert({
      path: { id: this.sessionId },
      body: { messageID, partID },
    });
  }

  async sendFeedback(text: string): Promise<void> {
    await this.client.session.prompt({
      path: { id: this.sessionId },
      body: { text },
    });
  }
}

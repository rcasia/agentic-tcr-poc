import type { ExecutionContext, Mutation } from "./mutation.js";

export type OpenCodeMutationObserver = (
  context: ExecutionContext,
) => Promise<Mutation>;

export type OpenCodeFileEditedEvent = {
  type: "file.edited";
  properties: {
    sessionID: string;
    file: string;
  };
};

/**
 * Turns noisy file events into one mutation boundary at session idle.
 * The adapter's session diff remains the source of truth for changed files.
 */
export class OpenCodeMutationCapture {
  private readonly pendingFiles = new Map<string, Set<string>>();

  recordFileEdited(event: OpenCodeFileEditedEvent): void {
    const files = this.pendingFiles.get(event.properties.sessionID) ?? new Set<string>();
    files.add(event.properties.file);
    this.pendingFiles.set(event.properties.sessionID, files);
  }

  hasPendingMutation(sessionId: string): boolean {
    return (this.pendingFiles.get(sessionId)?.size ?? 0) > 0;
  }

  async captureOnIdle(
    sessionId: string,
    context: ExecutionContext,
    observeMutation: OpenCodeMutationObserver,
  ): Promise<Mutation | undefined> {
    if (!this.hasPendingMutation(sessionId)) {
      return undefined;
    }

    const mutation = await observeMutation(context);
    this.pendingFiles.delete(sessionId);

    return mutation.changes?.length === 0 ? undefined : mutation;
  }

  clearSession(sessionId: string): void {
    this.pendingFiles.delete(sessionId);
  }
}

import { createOpenCodeTcrPluginState } from "../../src/opencode-plugin.ts";

type PluginContext = {
  directory: string;
  worktree: string;
};

type SessionEvent = {
  type?: string;
  properties?: {
    info?: { id?: string };
    sessionID?: string;
  };
};

/** Project-local OpenCode plugin entrypoint. */
export const AgenticTcrPlugin = async (context: PluginContext) => {
  const state = createOpenCodeTcrPluginState(context.worktree || context.directory);

  return {
    event: async ({ event }: { event: SessionEvent }) => {
      const sessionId = event.properties?.info?.id ?? event.properties?.sessionID;
      if (sessionId === undefined) {
        return;
      }

      if (event.type === "session.deleted" || event.type === "session.error") {
        state.disposeSession(sessionId);
        return;
      }

      if (
        event.type === "session.created"
        || event.type === "session.status"
        || event.type === "session.updated"
        || event.type === "session.idle"
      ) {
        state.initializeSession(sessionId);
      }
    },
    dispose: async () => {
      state.dispose();
    },
  };
};

export default AgenticTcrPlugin;

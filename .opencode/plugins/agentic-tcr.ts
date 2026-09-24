import { createOpenCodeTcrPluginState } from "../../src/opencode-plugin.ts";
import type { OpenCodeSessionLifecycleEvent } from "../../src/opencode-plugin.ts";

type PluginContext = {
  directory: string;
  worktree: string;
  client?: {
    app?: {
      log?: (input: { body: { service: string; level: string; message: string } }) => Promise<unknown>;
    };
    tui?: {
      showToast?: (input: {
        body: { title: string; message: string; variant: "info" | "success" | "warning" | "error"; duration?: number };
      }) => Promise<unknown>;
    };
  };
};

/** Project-local OpenCode plugin entrypoint. */
export const AgenticTcrPlugin = async (context: PluginContext) => {
  const state = createOpenCodeTcrPluginState(context.worktree || context.directory);
  const message = `Agentic TCR activo en ${context.worktree || context.directory}`;

  await Promise.allSettled([
    context.client?.app?.log?.({
      body: { service: "agentic-tcr", level: "info", message },
    }),
    context.client?.tui?.showToast?.({
      body: {
        title: "Agentic TCR",
        message,
        variant: "info",
        duration: 5000,
      },
    }),
  ]);

  return {
    event: async ({ event }: { event: OpenCodeSessionLifecycleEvent }) => {
      state.handleEvent(event);
    },
    dispose: async () => {
      state.dispose();
    },
  };
};

export default AgenticTcrPlugin;

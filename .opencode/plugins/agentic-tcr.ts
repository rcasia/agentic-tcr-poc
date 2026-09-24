import { createOpenCodeTcrPluginState } from "../../src/opencode-plugin.ts";
import type { OpenCodeSessionLifecycleEvent } from "../../src/opencode-plugin.ts";

type PluginContext = {
  directory: string;
  worktree: string;
};

/** Project-local OpenCode plugin entrypoint. */
export const AgenticTcrPlugin = async (context: PluginContext) => {
  const state = createOpenCodeTcrPluginState(context.worktree || context.directory);

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

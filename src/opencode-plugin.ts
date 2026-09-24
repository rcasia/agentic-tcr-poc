import {
  MutationScopeGuard,
  type ExecutionContext,
} from "./mutation.js";
import {
  createProjectVerifier,
  type ConfiguredProjectVerifier,
} from "./project-verification.js";
import type { Verifier } from "./verification.js";

export type OpenCodeTcrSession = {
  sessionId: string;
  context: ExecutionContext;
  scopeGuard: MutationScopeGuard;
};

export type OpenCodeTcrPluginState = {
  projectRoot: string;
  configuration: ConfiguredProjectVerifier["configuration"];
  verifier: Verifier;
  sessions: ReadonlyMap<string, OpenCodeTcrSession>;
  initializeSession(sessionId: string): OpenCodeTcrSession;
  disposeSession(sessionId: string): void;
  dispose(): void;
};

export function createOpenCodeTcrPluginState(
  projectRoot: string,
): OpenCodeTcrPluginState {
  const configured = createProjectVerifier(projectRoot);
  const sessions = new Map<string, OpenCodeTcrSession>();

  return {
    projectRoot,
    configuration: configured.configuration,
    verifier: configured.verifier,
    sessions,
    initializeSession(sessionId) {
      const existing = sessions.get(sessionId);
      if (existing !== undefined) {
        return existing;
      }

      const session: OpenCodeTcrSession = {
        sessionId,
        context: {
          executionId: `opencode:${sessionId}`,
          workspaceId: projectRoot,
          scopeId: projectRoot,
          sequence: 1,
        },
        scopeGuard: new MutationScopeGuard(),
      };
      sessions.set(sessionId, session);
      return session;
    },
    disposeSession(sessionId) {
      sessions.delete(sessionId);
    },
    dispose() {
      sessions.clear();
    },
  };
}

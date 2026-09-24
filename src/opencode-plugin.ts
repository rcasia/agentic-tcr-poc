import {
  MutationScopeGuard,
  type ExecutionContext,
} from "./mutation.js";
import {
  createProjectVerifier,
  type ConfiguredProjectVerifier,
} from "./project-verification.js";
import type { Verifier } from "./verification.js";
import { isAbsolute, resolve } from "node:path";

export type OpenCodeTcrSession = {
  sessionId: string;
  context: ExecutionContext;
  scopeGuard: MutationScopeGuard;
};

export type OpenCodeSessionInfo = {
  id?: string;
  directory?: string;
  worktree?: string;
};

export type OpenCodeSessionLifecycleEvent = {
  type?: string;
  properties?: {
    info?: OpenCodeSessionInfo;
    sessionID?: string;
  };
};

export type OpenCodeTcrPluginState = {
  projectRoot: string;
  configuration: ConfiguredProjectVerifier["configuration"];
  verifier: Verifier;
  sessions: ReadonlyMap<string, OpenCodeTcrSession>;
  initializeSession(sessionId: string, info?: OpenCodeSessionInfo): OpenCodeTcrSession;
  nextMutationContext(sessionId: string): ExecutionContext;
  getSession(sessionId: string): OpenCodeTcrSession | undefined;
  handleEvent(event: OpenCodeSessionLifecycleEvent): OpenCodeTcrSession | undefined;
  disposeSession(sessionId: string): void;
  dispose(): void;
};

export function createOpenCodeTcrPluginState(
  projectRoot: string,
): OpenCodeTcrPluginState {
  const resolvedProjectRoot = resolve(projectRoot);
  const configured = createProjectVerifier(resolvedProjectRoot);
  const sessions = new Map<string, OpenCodeTcrSession>();

  return {
    projectRoot: resolvedProjectRoot,
    configuration: configured.configuration,
    verifier: configured.verifier,
    sessions,
    initializeSession(sessionId, info = {}) {
      const existing = sessions.get(sessionId);
      if (existing !== undefined) {
        return existing;
      }

      const workspaceId = info.directory === undefined
        ? resolvedProjectRoot
        : resolve(info.directory);
      const scopeId = info.worktree === undefined
        ? workspaceId
        : resolve(info.worktree);
      const session: OpenCodeTcrSession = {
        sessionId,
        context: {
          executionId: `opencode:${sessionId}`,
          workspaceId,
          scopeId,
          sequence: 1,
        },
        scopeGuard: new MutationScopeGuard(),
      };
      sessions.set(sessionId, session);
      return session;
    },
    nextMutationContext(sessionId) {
      const session = sessions.get(sessionId);
      if (session === undefined) {
        throw new Error(`Unknown OpenCode session ${sessionId}`);
      }
      const context = {
        ...session.context,
        sequence: session.context.sequence + 1,
      };
      sessions.set(sessionId, { ...session, context });
      return context;
    },
    getSession(sessionId) {
      return sessions.get(sessionId);
    },
    handleEvent(event) {
      const info = event.properties?.info;
      const sessionId = info?.id ?? event.properties?.sessionID;
      if (sessionId === undefined) {
        return undefined;
      }
      const location = info?.directory ?? info?.worktree;
      if (location !== undefined && !isInProject(resolvedProjectRoot, location)) {
        return undefined;
      }
      if (event.type === "session.error" || event.type === "session.deleted") {
        const session = sessions.get(sessionId);
        sessions.delete(sessionId);
        return session;
      }
      if (
        event.type === "session.created"
        || event.type === "session.status"
        || event.type === "session.updated"
        || event.type === "session.idle"
      ) {
        return this.initializeSession(sessionId, info);
      }
      return sessions.get(sessionId);
    },
    disposeSession(sessionId) {
      sessions.delete(sessionId);
    },
    dispose() {
      sessions.clear();
    },
  };
}

function isInProject(projectRoot: string, location: string): boolean {
  const resolvedLocation = resolve(location);
  return resolvedLocation === projectRoot || resolvedLocation.startsWith(`${projectRoot}/`);
}
